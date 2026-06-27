// Estadísticas de duplicados sobre el reports.json del bucket.
// Uso: node scripts/stats.mjs
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({
  region: process.env.BUCKET_REGION ?? "auto",
  endpoint: process.env.BUCKET_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.BUCKET_ACCESS_KEY_ID,
    secretAccessKey: process.env.BUCKET_SECRET_ACCESS_KEY,
  },
});

const res = await s3.send(
  new GetObjectCommand({ Bucket: process.env.BUCKET_NAME, Key: "reports.json" }),
);
const data = JSON.parse(await res.Body.transformToString());
const reports = Object.values(data);

const norm = (s) =>
  (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

console.log("total reportes (claves UUID):", reports.length);
console.log("UUIDs únicos:", new Set(Object.keys(data)).size);

const byName = new Map();
for (const r of reports) {
  const n = norm(r.nombre);
  byName.set(n, (byName.get(n) || 0) + 1);
}
const dups = [...byName.entries()]
  .filter(([, c]) => c > 1)
  .sort((a, b) => b[1] - a[1]);
const reportesEnGruposDup = dups.reduce((s, [, c]) => s + c, 0);

console.log("nombres distintos (normalizados):", byName.size);
console.log("nombres que aparecen >1 vez:", dups.length);
console.log("reportes que comparten nombre con otro:", reportesEnGruposDup);
console.log("\nTop 12 nombres más repetidos:");
for (const [n, c] of dups.slice(0, 12)) console.log(`  ${c}×  ${n}`);

// Estados
const porEstado = {};
for (const r of reports) porEstado[r.estado] = (porEstado[r.estado] || 0) + 1;
console.log("\nPor estado:", JSON.stringify(porEstado));
