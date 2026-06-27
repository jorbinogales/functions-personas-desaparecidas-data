// Migra los datos antiguos de la raíz del bucket a la sección desaparecidos/.
//   reports.json  -> desaparecidos/items.json
//   state.json    -> desaparecidos/state.json
//   changes/*     -> desaparecidos/changes/*
// Copia (server-side) y luego borra los originales de la raíz.
// Uso: node scripts/migrate-sections.mjs
import {
  S3Client,
  CopyObjectCommand,
  DeleteObjectCommand,
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

const copy = async (from, to) => {
  await s3.send(
    new CopyObjectCommand({
      Bucket,
      CopySource: `${Bucket}/${from}`,
      Key: to,
    }),
  );
  console.log(`  copiado ${from} -> ${to}`);
};
const del = async (key) => {
  await s3.send(new DeleteObjectCommand({ Bucket, Key: key }));
  console.log(`  borrado ${key}`);
};

// 1) construir la lista de objetos a migrar (raíz, no los que ya están en secciones)
const moves = [
  ["reports.json", "desaparecidos/items.json"],
  ["state.json", "desaparecidos/state.json"],
];
const ls = await s3.send(
  new ListObjectsV2Command({ Bucket, Prefix: "changes/" }),
);
for (const o of ls.Contents ?? []) {
  moves.push([o.Key, `desaparecidos/${o.Key}`]);
}

console.log(`Migrando ${moves.length} objetos...`);
const copiados = [];
for (const [from, to] of moves) {
  try {
    await copy(from, to);
    copiados.push(from);
  } catch (e) {
    console.log(`  (omito ${from}: ${e.name ?? e.message})`);
  }
}

// 2) borrar originales ya copiados — SOLO si MIGRATE_DELETE=1
if (process.env.MIGRATE_DELETE === "1") {
  for (const from of copiados) {
    try {
      await del(from);
    } catch (e) {
      console.log(`  (no se pudo borrar ${from}: ${e.name ?? e.message})`);
    }
  }
  console.log("Migración lista (originales borrados).");
} else {
  console.log(
    "Migración por COPIA lista (raíz intacta). Para borrar luego: MIGRATE_DELETE=1",
  );
}
