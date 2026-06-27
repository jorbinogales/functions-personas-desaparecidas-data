import { createHash } from "node:crypto";
import { fetchHtml } from "../http.js";
import { BASE_URL, parseMapa } from "../parse.js";
import { Section } from "../store.js";
import type { MapaPoint } from "../types.js";

const section = new Section("mapa");
const hashId = (s: string): string =>
  createHash("sha1").update(s).digest("hex").slice(0, 16);

export interface MapaSummary {
  section: "mapa";
  runId: string;
  runAt: string;
  durationMs: number;
  total: number;
  nuevos: number;
  retirados: number;
  vigentes: number;
  porKind: Record<string, number>;
}

export async function runMapa(): Promise<MapaSummary> {
  const startedAt = Date.now();
  const runAt = new Date().toISOString();
  const runId = runAt.replace(/[:.]/g, "-");

  const store = await section.loadItems<MapaPoint>();
  const html = await fetchHtml(`${BASE_URL}/mapa`);
  const points = html ? parseMapa(html) : [];

  const nuevos: MapaPoint[] = [];
  const vistos = new Set<string>();
  const porKind: Record<string, number> = {};

  for (const p of points) {
    porKind[p.kind] = (porKind[p.kind] ?? 0) + 1;
    const id = hashId(`${p.lat}|${p.lng}|${p.title}`);
    vistos.add(id);
    const now = new Date().toISOString();
    const existing = store[id];
    if (!existing) {
      const mp: MapaPoint = {
        id,
        lat: p.lat,
        lng: p.lng,
        title: p.title,
        subtitle: p.subtitle,
        kind: p.kind,
        fuente: p.fuente,
        firstSeenAt: now,
        lastSeenAt: now,
        vigente: true,
      };
      store[id] = mp;
      nuevos.push(mp);
    } else {
      existing.lastSeenAt = now;
      existing.vigente = true;
      if (existing.subtitle == null && p.subtitle) existing.subtitle = p.subtitle;
    }
  }

  let retirados = 0;
  for (const p of Object.values(store)) {
    if (!vistos.has(p.id) && p.vigente) {
      p.vigente = false;
      retirados++;
    }
  }

  await section.saveItems(store);

  const summary: MapaSummary = {
    section: "mapa",
    runId,
    runAt,
    durationMs: Date.now() - startedAt,
    total: Object.keys(store).length,
    nuevos: nuevos.length,
    retirados,
    vigentes: points.length,
    porKind,
  };

  if (nuevos.length > 0 || retirados > 0) {
    await section.writeChanges(runId, { ...summary, nuevos });
  }
  await section.writeState(summary);

  return summary;
}
