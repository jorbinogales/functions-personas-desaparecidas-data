// Borra los objetos de la RAÍZ del bucket que no pertenecen a ninguna sección.
// (limpieza post-migración). Uso: node scripts/clean-root.mjs
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectCommand,
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

const SECCIONES = ["desaparecidos/", "noticias/", "mapa/"];
const ls = await s3.send(new ListObjectsV2Command({ Bucket }));
let borrados = 0;
for (const o of ls.Contents ?? []) {
  if (SECCIONES.some((p) => o.Key.startsWith(p))) continue;
  await s3.send(new DeleteObjectCommand({ Bucket, Key: o.Key }));
  console.log("borrado", o.Key);
  borrados++;
}
console.log(`Listo. ${borrados} objetos de raíz borrados.`);
