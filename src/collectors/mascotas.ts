import { fetchJson } from "../http.js";
import { Section, writeRawSnapshot } from "../store.js";
import type { MascotaReport } from "../types.js";

/**
 * Colector de mascotasvzla.org (mascotas perdidas/encontradas). El sitio usa
 * Supabase (PostgREST) y expone su clave anon en el HTML público, así que vamos
 * DIRECTO a su REST y paginamos la tabla `reports` por offset (máx 1000/req).
 * Salida: mascotas/items.json + raw/mascotasvzla/mascotas_*.json (ambos buckets).
 */
const SB_URL = "https://rvcmndxjkmzwutbqzbfj.supabase.co/rest/v1";
const SB_ANON =
  process.env.MASCOTAS_SUPABASE_ANON ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ2Y21uZHhqa216d3V0YnF6YmZqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzOTU3NTUsImV4cCI6MjA5Nzk3MTc1NX0.A-BhvafWd2CP321URDW1rJFAnIoffsLkXOWbJnPdwGI";
const PAGE = 1000;

/** Carpeta de salida dentro de raw/ (requerida): raw/mascotasvzla/mascotas_*.json */
const RAW_FOLDER = "mascotasvzla";
const RAW_TIPO = "mascotas";

const section = new Section("mascotas");

/** Forma cruda de cada fila de la tabla `reports` de Supabase. */
interface RawPet {
  id?: string;
  status?: string | null;
  species?: string | null;
  pet_name?: string | null;
  color?: string | null;
  place?: string | null;
  description?: string | null;
  services?: unknown;
  photo_url?: string | null;
  contact_name?: string | null;
  contact?: string | null;
  lat?: number | string | null;
  lng?: number | string | null;
  created_at?: string | null;
}

const toNum = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const toStr = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v : null;

/** Recorre la tabla `reports` paginando por offset (order estable). */
async function fetchAll(): Promise<RawPet[]> {
  const headers = { apikey: SB_ANON, authorization: `Bearer ${SB_ANON}` };
  const all: RawPet[] = [];
  for (let offset = 0; offset < 200_000; offset += PAGE) {
    const url = `${SB_URL}/reports?select=*&order=created_at.asc,id.asc&limit=${PAGE}&offset=${offset}`;
    const batch = await fetchJson<RawPet[]>(url, 3, headers);
    if (!Array.isArray(batch) || batch.length === 0) break;
    all.push(...batch);
    if (batch.length < PAGE) break;
  }
  return all;
}

export interface MascotasSummary {
  section: "mascotas";
  runId: string;
  runAt: string;
  durationMs: number;
  total: number;
  nuevos: number;
  retirados: number;
  vigentes: number;
  conCoords: number;
  porStatus: Record<string, number>;
}

export async function runMascotas(): Promise<MascotasSummary> {
  const startedAt = Date.now();
  const runAt = new Date().toISOString();
  const runId = runAt.replace(/[:.]/g, "-");

  const store = await section.loadItems<MascotaReport>();
  const rows = await fetchAll();

  const nuevos: MascotaReport[] = [];
  const vistos = new Set<string>();
  const porStatus: Record<string, number> = {};
  let conCoords = 0;

  for (const it of rows) {
    const id = toStr(it.id);
    if (!id) continue;
    vistos.add(id);
    const now = new Date().toISOString();
    const lat = toNum(it.lat);
    const lng = toNum(it.lng);
    if (lat != null && lng != null) conCoords++;
    const status = toStr(it.status) ?? "?";
    porStatus[status] = (porStatus[status] ?? 0) + 1;
    const services = Array.isArray(it.services) ? (it.services as string[]) : [];

    const existing = store[id];
    if (!existing) {
      const p: MascotaReport = {
        id,
        status: toStr(it.status),
        species: toStr(it.species),
        petName: toStr(it.pet_name),
        color: toStr(it.color),
        place: toStr(it.place),
        description: toStr(it.description),
        services,
        photoUrl: toStr(it.photo_url),
        contactName: toStr(it.contact_name),
        contact: toStr(it.contact),
        lat,
        lng,
        sourceCreatedAt: toStr(it.created_at),
        firstSeenAt: now,
        lastSeenAt: now,
        vigente: true,
      };
      store[id] = p;
      nuevos.push(p);
    } else {
      // Visto de nuevo: refrescamos campos que el origen pueda ir completando.
      existing.lastSeenAt = now;
      existing.vigente = true;
      existing.status = toStr(it.status) ?? existing.status;
      if (toStr(it.species)) existing.species = toStr(it.species);
      if (toStr(it.pet_name)) existing.petName = toStr(it.pet_name);
      if (toStr(it.color)) existing.color = toStr(it.color);
      if (toStr(it.place)) existing.place = toStr(it.place);
      if (toStr(it.description)) existing.description = toStr(it.description);
      if (services.length) existing.services = services;
      if (toStr(it.photo_url)) existing.photoUrl = toStr(it.photo_url);
      existing.contactName = toStr(it.contact_name) ?? existing.contactName;
      existing.contact = toStr(it.contact) ?? existing.contact;
      if (lat != null) existing.lat = lat;
      if (lng != null) existing.lng = lng;
      existing.sourceCreatedAt = toStr(it.created_at) ?? existing.sourceCreatedAt;
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
      // Baseline + delta van a raw/mascotasvzla/ en ambos buckets.
      await writeRawSnapshot(RAW_FOLDER, RAW_TIPO, allItems);
    } catch (err) {
      console.warn(`  ! raw snapshot falló: ${(err as Error).message}`);
    }
  }

  const summary: MascotasSummary = {
    section: "mascotas",
    runId,
    runAt,
    durationMs: Date.now() - startedAt,
    total: Object.keys(store).length,
    nuevos: nuevos.length,
    retirados,
    vigentes: vistos.size,
    conCoords,
    porStatus,
  };

  if (nuevos.length > 0 || retirados > 0) {
    await section.writeChanges(runId, { ...summary, nuevos });
  }
  await section.writeState(summary);

  return summary;
}
