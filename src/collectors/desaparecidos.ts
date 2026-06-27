import { fetchHtml, sleep } from "../http.js";
import { BASE_URL, parseDetail, parseListing } from "../parse.js";
import { Section, writeRawSnapshot } from "../store.js";
import { ESTADOS, type Report } from "../types.js";

const section = new Section("desaparecidos");

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(n) ? n : fallback;
}

const cfg = {
  delayMs: envInt("REQUEST_DELAY_MS", 600),
  maxPages: envInt("MAX_PAGES", 2000),
  stopAfterKnownPages: envInt("STOP_AFTER_KNOWN_PAGES", 2),
  fullScan: process.env.FULL_SCAN === "1",
  enrichNew: process.env.ENRICH_NEW !== "0",
  enrichBatch: envInt("ENRICH_BATCH", 0),
};

async function enrich(r: Report): Promise<void> {
  try {
    const html = await fetchHtml(r.url);
    if (!html) return;
    const d = parseDetail(html);
    if (d.nombre) r.nombre = d.nombre;
    if (d.ubicacion) r.ubicacion = d.ubicacion;
    r.genero = d.genero;
    r.ultimaVezVisto = d.ultimaVezVisto;
    r.publicadoRelativo = d.publicadoRelativo;
    r.verificacion = d.verificacion;
    r.detalles = d.detalles;
    if (!r.fotoUrl && d.fotoUrl) r.fotoUrl = d.fotoUrl;
    r.enrichedAt = new Date().toISOString();
  } catch (err) {
    console.warn(`  ! enrich falló ${r.id}: ${(err as Error).message}`);
  }
}

export interface DesaparecidosSummary {
  section: "desaparecidos";
  runId: string;
  runAt: string;
  durationMs: number;
  pagesFetched: number;
  total: number;
  nuevos: number;
  cambios: number;
  enriquecidos: number;
  externosMerged: number;
}

export async function runDesaparecidos(): Promise<DesaparecidosSummary> {
  const startedAt = Date.now();
  const runAt = new Date().toISOString();
  const runId = runAt.replace(/[:.]/g, "-");

  const store = await section.loadItems<Report>();
  const firstRun = Object.keys(store).length === 0;
  const fullScan = cfg.fullScan || firstRun;

  const nuevos: Report[] = [];
  const cambios: {
    id: string;
    nombre: string;
    de: string;
    a: string;
    at: string;
  }[] = [];
  let pagesFetched = 0;

  for (const estado of ESTADOS) {
    let page = 1;
    let knownStreak = 0;

    while (page <= cfg.maxPages) {
      const url = `${BASE_URL}/buscar?status=${estado}&page=${page}&vista=cuadricula`;
      const html = await fetchHtml(url);
      pagesFetched++;
      const cards = html ? parseListing(html) : [];
      if (cards.length === 0) break;

      if (page % 25 === 0) {
        console.log(
          `  … ${estado} pág ${page} · acumulado ${Object.keys(store).length} reportes`,
        );
      }

      let pageChanged = false;

      for (const c of cards) {
        const now = new Date().toISOString();
        const existing = store[c.id];

        if (!existing) {
          const r: Report = {
            id: c.id,
            origen: "venezuelareporta",
            url: c.url,
            nombre: c.nombre,
            edad: c.edad,
            ubicacion: c.ubicacion,
            estado,
            fotoUrl: c.fotoUrl,
            genero: null,
            ultimaVezVisto: null,
            publicadoRelativo: null,
            verificacion: null,
            detalles: {},
            firstSeenAt: now,
            lastSeenAt: now,
            enrichedAt: null,
            statusHistory: [{ estado, at: now }],
          };
          if (cfg.enrichNew) {
            await enrich(r);
            await sleep(cfg.delayMs);
          }
          store[c.id] = r;
          nuevos.push(r);
          pageChanged = true;
        } else {
          existing.lastSeenAt = now;
          if (!existing.fotoUrl && c.fotoUrl) existing.fotoUrl = c.fotoUrl;
          if (existing.edad == null && c.edad != null) existing.edad = c.edad;
          if (existing.estado !== estado) {
            cambios.push({
              id: c.id,
              nombre: existing.nombre,
              de: existing.estado,
              a: estado,
              at: now,
            });
            existing.estado = estado;
            existing.statusHistory.push({ estado, at: now });
            pageChanged = true;
          }
        }
      }

      if (!fullScan && !pageChanged) {
        knownStreak++;
        if (knownStreak >= cfg.stopAfterKnownPages) break;
      } else {
        knownStreak = 0;
      }

      page++;
      await sleep(cfg.delayMs);
    }
  }

  let enriquecidos = 0;
  if (cfg.enrichBatch > 0) {
    const pendientes = Object.values(store)
      .filter((r) => !r.enrichedAt)
      .slice(0, cfg.enrichBatch);
    for (const r of pendientes) {
      await enrich(r);
      enriquecidos++;
      await sleep(cfg.delayMs);
    }
  }

  // Fusiona las fuentes externas (escritas por los colectores de navegador) en la
  // lista unificada. Cada *-items.json tiene un único escritor (su colector), así
  // que aquí sólo leemos y volcamos en items.json (del que somos único escritor).
  let externosMerged = 0;
  for (const file of ["dtv-items.json", "vtb-items.json"]) {
    try {
      const ext = await section.loadOther<Report>(file);
      if (!ext) continue;
      for (const [id, r] of Object.entries(ext)) {
        const ex = store[id];
        store[id] = ex ? { ...r, firstSeenAt: ex.firstSeenAt } : r;
        externosMerged++;
      }
    } catch (err) {
      console.warn(`  ! merge ${file} falló: ${(err as Error).message}`);
    }
  }

  await section.saveItems(store);

  // Snapshot crudo COMPLETO de venezuela reporta (todo el dataset de esa fuente,
  // tomado del store ya cargado — sin re-scrapear).
  const vrItems = Object.values(store).filter(
    (r) => !r.id.startsWith("dtv:") && !r.id.startsWith("vtb:"),
  );
  if (vrItems.length > 0) {
    try {
      await writeRawSnapshot("Venezuela reporta", "desaparecidos", vrItems);
    } catch (err) {
      console.warn(`  ! raw snapshot falló: ${(err as Error).message}`);
    }
  }

  const summary: DesaparecidosSummary = {
    section: "desaparecidos",
    runId,
    runAt,
    durationMs: Date.now() - startedAt,
    pagesFetched,
    total: Object.keys(store).length,
    nuevos: nuevos.length,
    cambios: cambios.length,
    enriquecidos,
    externosMerged,
  };

  if (nuevos.length > 0 || cambios.length > 0) {
    await section.writeChanges(runId, { ...summary, nuevos, cambios });
  }
  await section.writeState(summary);

  return summary;
}
