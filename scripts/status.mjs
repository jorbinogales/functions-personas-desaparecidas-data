// Estado actual: lee state.json, reports.json y los changes/ del bucket.
// Uso: node scripts/status.mjs
import {
  S3Client,
  GetObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";

const Bucket = process.env.BUCKET_NAME;
const s3 = new S3Client({
  region: process.env.BUCKET_REGION ?? "auto",
  endpoint: process.env.BUCKET_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.BUCKET_ACCESS_KEY_ID,
    secretAccessKey: process.env.BUCKET_SECRET_ACCESS_KEY,
  },
});
const get = async (Key) =>
  (await s3.send(new GetObjectCommand({ Bucket, Key })).then((r) => r.Body))
    .transformToString();

console.log("Hora actual (UTC):", new Date().toISOString());

const state = JSON.parse(await get("state.json"));
console.log("\n== state.json (última corrida) ==");
console.log(JSON.stringify(state, null, 2));

const reports = JSON.parse(await get("reports.json"));
const vals = Object.values(reports);
const porEstado = {};
for (const r of vals) porEstado[r.estado] = (porEstado[r.estado] || 0) + 1;
console.log("\n== reports.json ==");
console.log("total reportes:", vals.length);
console.log("por estado:", JSON.stringify(porEstado));

const ls = await s3.send(
  new ListObjectsV2Command({ Bucket, Prefix: "changes/" }),
);
const files = (ls.Contents ?? []).sort((a, b) => a.Key.localeCompare(b.Key));
console.log("\n== changes/ (diffs por corrida) ==");
console.log("archivos:", files.length);
for (const o of files)
  console.log(`  ${o.Key}  ${o.Size}b  ${o.LastModified?.toISOString()}`);
