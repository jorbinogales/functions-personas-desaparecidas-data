import { createHash } from "node:crypto";
import { fetchJson } from "../http.js";
import { Section, writeAggregateSnapshot } from "../store.js";

// localizapacientes.com solo expone agregados públicos por hospital (sin PII):
// /api/hospitals (lista con conteos) y /api/stats (totales). No hay endpoint para
// listar pacientes individuales (la búsqueda está topada a 50 a propósito), así que
// guardamos la serie temporal de agregados, no datos personales.
const API_BASE = "https://localizapacientes.com/api";
const RAW_FOLDER = "localizapacientes";
const RAW_TIPO = "hospitales";

const section = new Section("localiza");

interface Hospital {
  id: string;
  nombre: string;
  ciudad: string | null;
  estado: string | null;
  ultimaActualizacion: string | null;
  pacientesRegistrados: number;
  estadoReporte: string | null;
}
interface Stats {
  hospitalesReportando?: number;
  pacientesRegistrados?: number;
  estadosCubiertos?: number;
  actualizacionReciente?: string;
  ultimaSincronizacion?: string;
}

export interface LocalizaSummary {
  section: "localiza";
  runId: string;
  runAt: string;
  durationMs: number;
  hospitales: number;
  pacientesTotal: number;
  estadosCubiertos: number;
  cambio: boolean;
}

export async function runLocaliza(): Promise<LocalizaSummary> {
  const startedAt = Date.now();
  const runAt = new Date().toISOString();
  const runId = runAt.replace(/[:.]/g, "-");

  const [hospitalsRaw, stats] = await Promise.all([
    fetchJson<Hospital[]>(`${API_BASE}/hospitals`),
    fetchJson<Stats>(`${API_BASE}/stats`),
  ]);
  const hospitales = (Array.isArray(hospitalsRaw) ? hospitalsRaw : []).sort(
    (a, b) => String(a.id).localeCompare(String(b.id)),
  );

  const pacientesTotal = Number(
    stats?.pacientesRegistrados ??
      hospitales.reduce((s, h) => s + (Number(h.pacientesRegistrados) || 0), 0),
  );
  const estadosCubiertos = Number(stats?.estadosCubiertos ?? 0);

  // Firma de cambio: conteos + estado de reporte por hospital + totales. Excluye
  // timestamps volátiles para no escribir un archivo nuevo si nada cambió de fondo.
  const sigInput = JSON.stringify({
    h: hospitales.map((h) => [h.id, h.pacientesRegistrados, h.estadoReporte]),
    p: pacientesTotal,
    e: estadosCubiertos,
    n: stats?.hospitalesReportando ?? hospitales.length,
  });
  const signature = createHash("sha1").update(sigInput).digest("hex");

  const { written } = await writeAggregateSnapshot(
    RAW_FOLDER,
    RAW_TIPO,
    hospitales.length,
    signature,
    { stats, hospitales },
  );

  await section.writeState({
    runId,
    runAt,
    signature,
    hospitales: hospitales.length,
    pacientesTotal,
    estadosCubiertos,
    cambio: written,
  });

  return {
    section: "localiza",
    runId,
    runAt,
    durationMs: Date.now() - startedAt,
    hospitales: hospitales.length,
    pacientesTotal,
    estadosCubiertos,
    cambio: written,
  };
}
