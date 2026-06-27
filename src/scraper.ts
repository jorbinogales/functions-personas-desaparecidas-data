import { fetchHtml, sleep } from "./http.js";
import { BASE_URL, parseDetail, parseListing } from "./parse.js";
import {
  loadStore,
  saveStore,
  storageInfo,
  writeChanges,
  writeState,
  type Store,
} from "./store.js";
import { ESTADOS, type Report, type RunSummary } from "./types.js";

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

/** Trae la página de detalle y completa los campos extra del reporte. */
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

/** Ejecuta UN ciclo completo de scraping y persiste resultados. */
export async function runOnce(): Promise<RunSummary> {
  const startedAt = Date.now();
  const runAt = new Date().toISOString();
  const runId = runAt.replace(/[:.]/g, "-");

  const store: Store = await loadStore();
  const firstRun = Object.keys(store).length === 0;
  const fullScan = cfg.fullScan || firstRun;

  const nuevos: Report[] = [];
  const cambiosEstado: RunSummary["cambiosEstado"] = [];
  let pagesFetched = 0;

  console.log(
    `Iniciando corrida ${runId} · storage=${storageInfo} · fullScan=${fullScan} · enrichNew=${cfg.enrichNew}`,
  );

  for (const estado of ESTADOS) {
    let page = 1;
    let knownStreak = 0;

    while (page <= cfg.maxPages) {
      const url = `${BASE_URL}/buscar?status=${estado}&page=${page}&vista=cuadricula`;
      const html = await fetchHtml(url);
      pagesFetched++;
      const cards = html ? parseListing(html) : [];
      if (cards.length === 0) break;

      let pageChanged = false;

      for (const c of cards) {
        const now = new Date().toISOString();
        const existing = store[c.id];

        if (!existing) {
          const r: Report = {
            id: c.id,
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
            cambiosEstado.push({
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

      // En corridas incrementales, paramos cuando varias páginas seguidas
      // no traen nada nuevo (la lista está ordenada de más nuevo a más viejo).
      if (!fullScan && !pageChanged) {
        knownStreak++;
        if (knownStreak >= cfg.stopAfterKnownPages) break;
      } else {
        knownStreak = 0;
      }

      page++;
      await sleep(cfg.delayMs);
    }
    console.log(`  estado=${estado}: hasta página ${page}`);
  }

  // Backfill gradual del detalle de reportes viejos aún sin enriquecer.
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

  await saveStore(store);

  const summary: RunSummary = {
    runId,
    runAt,
    durationMs: Date.now() - startedAt,
    pagesFetched,
    totalReports: Object.keys(store).length,
    nuevos,
    cambiosEstado,
    enriquecidos,
  };

  if (nuevos.length > 0 || cambiosEstado.length > 0) {
    await writeChanges(runId, summary);
  }
  await writeState({
    lastRunAt: runAt,
    totalReports: summary.totalReports,
    lastRunNuevos: nuevos.length,
    lastRunCambios: cambiosEstado.length,
    lastRunPaginas: pagesFetched,
    lastRunDurationMs: summary.durationMs,
  });

  return summary;
}
