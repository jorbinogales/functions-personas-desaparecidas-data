// Valida los parsers contra HTML real guardado en test/fixtures/.
// Ejecuta:  npm run build  &&  npm run selftest
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  parseListing,
  parseDetail,
  parseNoticias,
  parseMapa,
} from "../dist/parse.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = (f) =>
  readFileSync(path.join(here, "..", "test", "fixtures", f), "utf8");

let failures = 0;
const check = (cond, msg) => {
  console.log(`${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) failures++;
};

// --- Desaparecidos: listado ---
const cards = parseListing(fx("listing.html"));
console.log(`\n[desaparecidos] ${cards.length} tarjetas`);
check(cards.length > 20, "el listado trae más de 20 tarjetas");
check(
  cards.every((c) => /^[0-9a-f-]{36}$/.test(c.id)),
  "todas las tarjetas tienen UUID válido",
);
check(
  cards.some((c) => typeof c.edad === "number"),
  "al menos una tarjeta trae edad",
);

// --- Desaparecidos: detalle ---
const d = parseDetail(fx("detail.html"));
check(!!d.nombre, "el detalle trae nombre");
check(!!d.genero, "el detalle trae género");

// --- Noticias ---
const noticias = parseNoticias(fx("noticias.html"));
console.log(`\n[noticias] ${noticias.length} ítems`);
console.log("primeras 2:", JSON.stringify(noticias.slice(0, 2), null, 2));
check(noticias.length > 10, "noticias: más de 10 ítems");
check(
  noticias.every((n) => /^https?:\/\//.test(n.url)),
  "noticias: todas con URL http(s)",
);
check(
  noticias.every((n) => n.titulo && n.titulo.length > 0),
  "noticias: todas con título",
);
check(
  noticias.some((n) => n.fuente),
  "noticias: al menos una con fuente",
);

// --- Mapa ---
const puntos = parseMapa(fx("mapa.html"));
console.log(`\n[mapa] ${puntos.length} puntos`);
console.log("primeros 2:", JSON.stringify(puntos.slice(0, 2), null, 2));
const kinds = [...new Set(puntos.map((p) => p.kind))];
console.log("kinds:", kinds.join(", "));
check(puntos.length > 500, "mapa: más de 500 puntos");
check(
  puntos.every(
    (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng),
  ),
  "mapa: todos con lat/lng numéricos",
);
check(
  puntos.some((p) => p.title && p.title.length > 0),
  "mapa: al menos uno con title",
);

console.log(`\n${failures === 0 ? "TODO OK" : failures + " CHEQUEOS FALLARON"}`);
process.exit(failures === 0 ? 0 : 1);
