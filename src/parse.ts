import * as cheerio from "cheerio";

export const BASE_URL = "https://venezuelareporta.org";

const UUID_RE = /reporte\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

export interface ListingCard {
  id: string;
  url: string;
  nombre: string;
  edad: number | null;
  ubicacion: string | null;
  fotoUrl: string | null;
}

export interface DetailInfo {
  nombre: string | null;
  ubicacion: string | null;
  publicadoRelativo: string | null;
  verificacion: string | null;
  genero: string | null;
  ultimaVezVisto: string | null;
  detalles: Record<string, string>;
  fotoUrl: string | null;
}

/** Separa "65 años · La Guaira" en edad + ubicación. */
function parseEdadUbicacion(text: string): {
  edad: number | null;
  ubicacion: string | null;
} {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return { edad: null, ubicacion: null };
  const ageMatch = clean.match(/(\d{1,3})\s*años?/i);
  const edad = ageMatch ? Number.parseInt(ageMatch[1]!, 10) : null;
  // Quita el prefijo "NN años ·" si existe; lo que queda es la ubicación.
  let ubicacion = clean;
  if (ageMatch) {
    ubicacion = clean.replace(/^\s*\d{1,3}\s*años?\s*(·\s*)?/i, "");
  }
  ubicacion = ubicacion.trim();
  return { edad, ubicacion: ubicacion || null };
}

/** Parsea una página de listado (cuadrícula o lista) y devuelve sus tarjetas. */
export function parseListing(html: string): ListingCard[] {
  const $ = cheerio.load(html);
  const cards: ListingCard[] = [];
  const seen = new Set<string>();

  $("a.card").each((_, el) => {
    const $el = $(el);
    const href = $el.attr("href") ?? "";
    const m = href.match(UUID_RE);
    if (!m) return;
    const id = m[1]!.toLowerCase();
    if (seen.has(id)) return;
    seen.add(id);

    const $img = $el.find("img").first();
    const nombre =
      $el.find("h3").first().text().trim() ||
      ($img.attr("alt") ?? "").replace(/^Foto de\s*/i, "").trim();

    const fotoUrl = $img.attr("src") ?? null;
    const infoText = $el.find("p").first().text();
    const { edad, ubicacion } = parseEdadUbicacion(infoText);

    cards.push({
      id,
      url: `${BASE_URL}/reporte/${id}`,
      nombre,
      edad,
      ubicacion,
      fotoUrl,
    });
  });

  return cards;
}

/** Parsea una página de detalle /reporte/{uuid}. */
export function parseDetail(html: string): DetailInfo {
  const $ = cheerio.load(html);

  const $h1 = $("h1").first();
  const nombre = $h1.text().trim() || null;
  const ubicacion = $h1.nextAll("p").first().text().trim() || null;

  let publicadoRelativo: string | null = null;
  $("p").each((_, el) => {
    if (publicadoRelativo) return;
    const t = $(el).text().replace(/\s+/g, " ").trim();
    if (/Publicado/i.test(t)) {
      const m = t.match(/Publicado\s*(.*?)\s*·/i);
      publicadoRelativo = (m ? m[1]! : t.replace(/Publicado/i, "")).trim() || null;
    }
  });

  let verificacion: string | null = null;
  $("span").each((_, el) => {
    if (verificacion) return;
    const t = $(el).text().trim();
    if (/verific/i.test(t) && t.length < 40) verificacion = t;
  });

  const detalles: Record<string, string> = {};
  $("dl dt").each((_, dt) => {
    const key = $(dt).text().trim();
    const value = $(dt).nextAll("dd").first().text().trim();
    if (key) detalles[key] = value;
  });

  const fotoUrl =
    $('img[alt^="Foto de"]').first().attr("src") ??
    $("main img, article img, img").first().attr("src") ??
    null;

  return {
    nombre,
    ubicacion,
    publicadoRelativo,
    verificacion,
    genero: detalles["Género"] ?? null,
    ultimaVezVisto: detalles["Última vez visto"] ?? null,
    detalles,
    fotoUrl,
  };
}
