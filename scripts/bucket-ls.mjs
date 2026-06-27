// Lista los objetos del bucket. Lee credenciales de las variables BUCKET_*.
// Uso: node scripts/bucket-ls.mjs
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";

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
  new ListObjectsV2Command({ Bucket: process.env.BUCKET_NAME }),
);
for (const o of res.Contents ?? []) {
  console.log(`${o.Key}\t${o.Size} bytes\t${o.LastModified?.toISOString()}`);
}
console.log(`total objetos: ${res.KeyCount ?? 0}`);
