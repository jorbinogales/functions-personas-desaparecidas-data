import { createHash } from "node:crypto";
import { fetchHtml, sleep } from "../http.js";
import { BASE_URL, parseNoticias } from "../parse.js";
import { Section } from "../store.js";
import type { Noticia } from "../types.js";

const section = new Section("noticias");
const TABS = ["news", "social", "videos"];
const hashId = (s: string): string =>
  createHash("sha1").update(s).digest("hex").slice(0, 16);

export interface NoticiasSummary {
  section: "noticias";
  runId: string;
  runAt: string;
  durationMs: number;
  total: number;
  nuevos: number;
  retirados: number;
  vigentes: number;
}

export async function runNoticias(): Promise<NoticiasSummary> {
  const startedAt = Date.now();
  const runAt = new Date().toISOString();
  const runId = runAt.replace(/[:.]/g, "-");

  const store = await section.loadItems<Noticia>();
  const nuevos: Noticia[] = [];
  const vistos = new Set<string>();

  for (const tab of TABS) {
    const html = await fetchHtml(`${BASE_URL}/noticias?tab=${tab}`);
    const items = html ? parseNoticias(html) : [];
    for (const it of items) {
      const id = hashId(it.url);
      vistos.add(id);
      const now = new Date().toISOString();
      const existing = store[id];
      if (!existing) {
        const n: Noticia = {
          id,
          titulo: it.titulo,
          url: it.url,
          fuente: it.fuente,
          fecha: it.fecha,
          tab,
          firstSeenAt: now,
          lastSeenAt: now,
          vigente: true,
        };
        store[id] = n;
        nuevos.push(n);
      } else {
        existing.lastSeenAt = now;
        existing.vigente = true;
        existing.tab = tab;
        if (it.titulo) existing.titulo = it.titulo;
        if (it.fecha) existing.fecha = it.fecha;
      }
    }
    await sleep(400);
  }

  let retirados = 0;
  for (const it of Object.values(store)) {
    if (!vistos.has(it.id) && it.vigente) {
      it.vigente = false;
      retirados++;
    }
  }

  await section.saveItems(store);

  const summary: NoticiasSummary = {
    section: "noticias",
    runId,
    runAt,
    durationMs: Date.now() - startedAt,
    total: Object.keys(store).length,
    nuevos: nuevos.length,
    retirados,
    vigentes: vistos.size,
  };

  if (nuevos.length > 0 || retirados > 0) {
    await section.writeChanges(runId, { ...summary, nuevos });
  }
  await section.writeState(summary);

  return summary;
}
