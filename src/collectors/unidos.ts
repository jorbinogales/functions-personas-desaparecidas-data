import { fetchJson } from "../http.js";
import { Section, writeRawSnapshot } from "../store.js";
import type { UnidosPoint } from "../types.js";

/** Agregador público que alimenta el mapa de unidosvenezuela.io. */
const API_BASE = "https://agg.unidosvenezuela.io";
/** Carpeta de salida dentro de raw/ (requerida): raw/unidosvenezuela/puntos_*.json */
const RAW_FOLDER = "unidosvenezuela";
const RAW_TIPO = "puntos";

const section = new Section("unidos");

/** Forma cruda de cada registro que devuelve GET /search. */
interface RawSearchItem {
  id?: string;
  source?: string | null;
  tipo?: string | null;
  estado?: string | null;
  titulo?: string | null;
  descripcion?: string | null;
  necesidad?: string | null;
  lat?: string | number | null;
  lng?: string | number | null;
  estado_geo?: string | null;
  direccion?: string | null;
  persona_nombre?: string | null;
  media_url?: string | null;
  first_seen_at?: string | null;
  last_seen_at?: string | null;
}

const toNum = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const toStr = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v : null;

export interface UnidosSummary {
  section: "unidos";
  runId: string;
  runAt: string;
  durationMs: number;
  total: number;
  nuevos: number;
  retirados: number;
  vigentes: number;
  conCoords: number;
  porTipo: Record<string, number>;
}

export async function runUnidos(): Promise<UnidosSummary> {
  const startedAt = Date.now();
  const runAt = new Date().toISOString();
  const runId = runAt.replace(/[:.]/g, "-");

  const store = await section.loadItems<UnidosPoint>();

  // El agregador no pagina: una sola llamada con limit alto trae todos los puntos.
  const raw = await fetchJson<RawSearchItem[]>(`${API_BASE}/search?limit=100000`);
  const items = Array.isArray(raw) ? raw : [];

  const nuevos: UnidosPoint[] = [];
  const vistos = new Set<string>();
  const porTipo: Record<string, number> = {};
  let conCoords = 0;

  for (const it of items) {
    const id = toStr(it.id);
    if (!id) continue;
    vistos.add(id);
    const now = new Date().toISOString();
    const lat = toNum(it.lat);
    const lng = toNum(it.lng);
    if (lat != null && lng != null) conCoords++;
    const tipo = toStr(it.tipo) ?? "otro";
    porTipo[tipo] = (porTipo[tipo] ?? 0) + 1;

    const existing = store[id];
    if (!existing) {
      const p: UnidosPoint = {
        id,
        source: toStr(it.source),
        tipo,
        estadoReporte: toStr(it.estado),
        titulo: toStr(it.titulo),
        descripcion: toStr(it.descripcion),
        necesidad: toStr(it.necesidad),
        lat,
        lng,
        estadoGeo: toStr(it.estado_geo),
        direccion: toStr(it.direccion),
        personaNombre: toStr(it.persona_nombre),
        mediaUrl: toStr(it.media_url),
        apiFirstSeenAt: toStr(it.first_seen_at),
        apiLastSeenAt: toStr(it.last_seen_at),
        firstSeenAt: now,
        lastSeenAt: now,
        vigente: true,
      };
      store[id] = p;
      nuevos.push(p);
    } else {
      // Visto de nuevo: refrescamos campos que el agregador puede ir completando.
      existing.lastSeenAt = now;
      existing.vigente = true;
      existing.tipo = tipo;
      existing.source = toStr(it.source) ?? existing.source;
      existing.estadoReporte = toStr(it.estado) ?? existing.estadoReporte;
      if (toStr(it.titulo)) existing.titulo = toStr(it.titulo);
      if (toStr(it.descripcion)) existing.descripcion = toStr(it.descripcion);
      existing.necesidad = toStr(it.necesidad) ?? existing.necesidad;
      if (lat != null) existing.lat = lat;
      if (lng != null) existing.lng = lng;
      existing.estadoGeo = toStr(it.estado_geo) ?? existing.estadoGeo;
      existing.direccion = toStr(it.direccion) ?? existing.direccion;
      existing.personaNombre = toStr(it.persona_nombre) ?? existing.personaNombre;
      existing.mediaUrl = toStr(it.media_url) ?? existing.mediaUrl;
      existing.apiLastSeenAt = toStr(it.last_seen_at) ?? existing.apiLastSeenAt;
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

  const allItems = Object.values(store);
  if (allItems.length > 0) {
    try {
      // Baseline + delta van a raw/unidosvenezuela/ en ambos buckets.
      await writeRawSnapshot(RAW_FOLDER, RAW_TIPO, allItems);
    } catch (err) {
      console.warn(`  ! raw snapshot falló: ${(err as Error).message}`);
    }
  }

  const summary: UnidosSummary = {
    section: "unidos",
    runId,
    runAt,
    durationMs: Date.now() - startedAt,
    total: Object.keys(store).length,
    nuevos: nuevos.length,
    retirados,
    vigentes: vistos.size,
    conCoords,
    porTipo,
  };

  if (nuevos.length > 0 || retirados > 0) {
    await section.writeChanges(runId, { ...summary, nuevos });
  }
  await section.writeState(summary);

  return summary;
}
