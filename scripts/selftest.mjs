// Valida el parser contra HTML real guardado en test/fixtures/.
// Ejecuta:  npm run build  &&  npm run selftest
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseListing, parseDetail } from "../dist/parse.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = (f) => readFileSync(path.join(here, "..", "test", "fixtures", f), "utf8");

let failures = 0;
const check = (cond, msg) => {
  console.log(`${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) failures++;
};

// --- Listado ---
const cards = parseListing(fx("listing.html"));
console.log(`\nListado: ${cards.length} tarjetas`);
console.log("Primeras 3:", JSON.stringify(cards.slice(0, 3), null, 2));
check(cards.length > 20, "el listado trae más de 20 tarjetas");
check(
  cards.every((c) => /^[0-9a-f-]{36}$/.test(c.id)),
  "todas las tarjetas tienen UUID válido",
);
check(
  cards.every((c) => c.nombre && c.nombre.length > 0),
  "todas las tarjetas tienen nombre",
);
check(
  cards.some((c) => typeof c.edad === "number"),
  "al menos una tarjeta trae edad numérica",
);
check(
  cards.some((c) => c.ubicacion && c.ubicacion.length > 0),
  "al menos una tarjeta trae ubicación",
);
check(
  cards.every((c) => !c.fotoUrl || c.fotoUrl.includes("supabase.co")),
  "las fotos (si hay) son URLs de supabase",
);

// --- Detalle ---
const d = parseDetail(fx("detail.html"));
console.log("\nDetalle:", JSON.stringify(d, null, 2));
check(!!d.nombre, "el detalle trae nombre");
check(!!d.genero, "el detalle trae género");
check(!!d.ultimaVezVisto, "el detalle trae 'última vez visto'");
check(!!d.publicadoRelativo, "el detalle trae 'publicado hace ...'");

console.log(`\n${failures === 0 ? "TODO OK" : failures + " CHEQUEOS FALLARON"}`);
process.exit(failures === 0 ? 0 : 1);
