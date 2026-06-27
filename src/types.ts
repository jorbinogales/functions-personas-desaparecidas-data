export type Estado = "buscando" | "encontrado" | "a_salvo";

/** Estados que se recorren, en orden. */
export const ESTADOS: Estado[] = ["buscando", "encontrado", "a_salvo"];

/** Etiqueta humana de cada estado (la que muestra el chip del sitio). */
export const ESTADO_LABEL: Record<Estado, string> = {
  buscando: "Se busca",
  encontrado: "Encontrado",
  a_salvo: "A salvo",
};

export interface StatusChange {
  estado: Estado;
  at: string;
}

/** Un reporte de persona desaparecida tal como lo guardamos. */
export interface Report {
  id: string; // UUID del reporte
  url: string; // URL absoluta a la página de detalle
  nombre: string;
  edad: number | null;
  ubicacion: string | null; // zona / ciudad / dirección
  estado: Estado;
  fotoUrl: string | null;

  // Campos que vienen de la página de detalle (enriquecimiento):
  genero: string | null;
  ultimaVezVisto: string | null; // texto libre "Última vez visto"
  publicadoRelativo: string | null; // "hace 5 min" (el sitio no da fecha exacta)
  verificacion: string | null; // p. ej. "Sin verificar"
  detalles: Record<string, string>; // todos los pares <dt>/<dd> del detalle

  // Metadatos de nuestro propio scraping:
  firstSeenAt: string; // ISO: primera vez que LO vimos nosotros
  lastSeenAt: string; // ISO: última vez que lo vimos en un listado
  enrichedAt: string | null; // ISO: cuándo trajimos su detalle
  statusHistory: StatusChange[];
}

export interface RunSummary {
  runId: string;
  runAt: string;
  durationMs: number;
  pagesFetched: number;
  totalReports: number;
  nuevos: Report[];
  cambiosEstado: {
    id: string;
    nombre: string;
    de: Estado;
    a: Estado;
    at: string;
  }[];
  enriquecidos: number;
}
