import { runDesaparecidos } from "./collectors/desaparecidos.js";
import { runNoticias } from "./collectors/noticias.js";
import { runMapa } from "./collectors/mapa.js";
import { runUnidos } from "./collectors/unidos.js";
import { storageInfo } from "./store.js";

const COLLECTORS: Record<string, () => Promise<unknown>> = {
  desaparecidos: runDesaparecidos,
  noticias: runNoticias,
  mapa: runMapa,
  unidos: runUnidos,
};

async function main(): Promise<void> {
  const which = (process.env.COLLECTORS ?? "desaparecidos,noticias,mapa,unidos")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  console.log(
    `[${new Date().toISOString()}] storage=${storageInfo} · colectores=${which.join(", ")}`,
  );

  let failures = 0;
  for (const name of which) {
    const fn = COLLECTORS[name];
    if (!fn) {
      console.warn(`! colector desconocido: ${name}`);
      continue;
    }
    const t0 = Date.now();
    try {
      const summary = await fn();
      console.log(
        `✓ ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s): ${JSON.stringify(summary)}`,
      );
    } catch (err) {
      failures++;
      console.error(`✗ ${name} falló:`, (err as Error).message);
    }
  }

  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fallo general:", err);
  process.exit(1);
});
