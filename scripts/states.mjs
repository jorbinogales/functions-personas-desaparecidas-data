// Imprime el state.json de cada sección. Uso: node scripts/states.mjs
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
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
for (const s of ["desaparecidos", "noticias", "mapa"]) {
  try {
    const r = await s3.send(
      new GetObjectCommand({ Bucket, Key: `${s}/state.json` }),
    );
    console.log(`\n== ${s}/state.json ==`);
    console.log(await r.Body.transformToString());
  } catch (e) {
    console.log(`\n== ${s} == (sin state.json: ${e.name})`);
  }
}
