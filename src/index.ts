import { runOnce } from "./scraper.js";

runOnce()
  .then((s) => {
    console.log(
      `\n[${s.runAt}] listo en ${(s.durationMs / 1000).toFixed(1)}s ` +
        `· páginas=${s.pagesFetched} · total=${s.totalReports} ` +
        `· nuevos=${s.nuevos.length} · cambios=${s.cambiosEstado.length} ` +
        `· enriquecidos=${s.enriquecidos}`,
    );
    for (const n of s.nuevos.slice(0, 25)) {
      console.log(`  + ${n.nombre} (${n.estado}) — ${n.ubicacion ?? "?"}`);
    }
    if (s.nuevos.length > 25) console.log(`  … y ${s.nuevos.length - 25} más`);
    for (const c of s.cambiosEstado) {
      console.log(`  ~ ${c.nombre}: ${c.de} → ${c.a}`);
    }
    process.exit(0);
  })
  .catch((err) => {
    console.error("La corrida FALLÓ:", err);
    process.exit(1);
  });
