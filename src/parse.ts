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

export interface NoticiaItem {
  titulo: string;
  url: string;
  fuente: string | null;
  fecha: string | null;
}

export interface MapaPointRaw {
  lat: number;
  lng: number;
  title: string;
  subtitle: string | null;
  kind: string;
  fuente: string | null;
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
  let ubicacion = clean;
  if (ageMatch) {
    ubicacion = clean.replace(/^\s*\d{1,3}\s*años?\s*(·\s*)?/i, "");
  }
  ubicacion = ubicacion.trim();
  return { edad, ubicacion: ubicacion || null };
}

/** Parsea una página de listado de desaparecidos (vista cuadrícula). */
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

/** Parsea una pestaña de /noticias: ítems <li><a target=_blank> con título/fuente/fecha. */
export function parseNoticias(html: string): NoticiaItem[] {
  const $ = cheerio.load(html);
  const items: NoticiaItem[] = [];
  const seen = new Set<string>();

  $("li a[target='_blank']").each((_, el) => {
    const $a = $(el);
    const url = $a.attr("href") ?? "";
    if (!/^https?:\/\//.test(url)) return;
    // Los ítems de noticia tienen un span de título en negrita; los enlaces de
    // navegación/compartir no.
    const titulo = $a.find("span.block").first().text().trim();
    if (!titulo) return;
    if (seen.has(url)) return;
    seen.add(url);

    const fuente = $a.find(".text-brand").first().text().trim() || null;
    let fecha: string | null = null;
    $a.find("span.mt-1 span, span.mt-1 > span").each((__, s) => {
      const t = $(s).text().trim();
      if (t && t !== "·" && t !== fuente) fecha = t;
    });

    items.push({ titulo, url, fuente, fecha });
  });

  return items;
}

/** Reconstruye el texto del payload RSC de Next.js a partir de los self.__next_f.push. */
function extractRscText(html: string): string {
  const re = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
  let out = "";
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      out += JSON.parse(`"${m[1]}"`);
    } catch {
      /* fragmento no parseable, ignorar */
    }
  }
  return out;
}

/** Extrae el array JSON que sigue a `marker` (p. ej. '"externos":'), respetando strings. */
function extractJsonArrayAfter(text: string, marker: string): unknown {
  const mi = text.indexOf(marker);
  if (mi < 0) return null;
  const start = text.indexOf("[", mi);
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') {
      inStr = true;
    } else if (c === "[") {
      depth++;
    } else if (c === "]") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Parsea /mapa: extrae los puntos de interés (array `externos` del payload RSC). */
export function parseMapa(html: string): MapaPointRaw[] {
  const rsc = extractRscText(html);
  const arr = extractJsonArrayAfter(rsc, '"externos":');
  if (!Array.isArray(arr)) return [];
  const out: MapaPointRaw[] = [];
  for (const p of arr as Record<string, unknown>[]) {
    const lat = Number(p["lat"]);
    const lng = Number(p["lng"]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const sub = p["subtitle"];
    out.push({
      lat,
      lng,
      title: typeof p["title"] === "string" ? (p["title"] as string) : "",
      subtitle:
        typeof sub === "string" && sub !== "$undefined" ? sub : null,
      kind: typeof p["kind"] === "string" ? (p["kind"] as string) : "",
      fuente: typeof p["fuente"] === "string" ? (p["fuente"] as string) : null,
    });
  }
  return out;
}
