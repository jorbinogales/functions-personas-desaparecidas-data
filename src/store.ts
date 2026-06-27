import { promises as fs } from "node:fs";
import path from "node:path";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

/** Abstracción de almacenamiento: bucket S3 (Railway) o filesystem (Volume/local). */
interface Backend {
  read(key: string): Promise<string | null>;
  write(key: string, data: string): Promise<void>;
  list(prefix: string): Promise<{ key: string; lastModified: number }[]>;
  del(key: string): Promise<void>;
  describe(): string;
}

/** Filesystem: Railway Volume montado o ./data en local. */
class FsBackend implements Backend {
  constructor(private readonly dir: string) {}
  describe(): string {
    return `filesystem:${this.dir}`;
  }
  async read(key: string): Promise<string | null> {
    try {
      return await fs.readFile(path.join(this.dir, key), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }
  async write(key: string, data: string): Promise<void> {
    const full = path.join(this.dir, key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    const tmp = `${full}.tmp`;
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, full); // escritura atómica
  }
  async list(prefix: string): Promise<{ key: string; lastModified: number }[]> {
    const dir = path.join(this.dir, path.dirname(prefix));
    const base = path.basename(prefix);
    try {
      const files = await fs.readdir(dir);
      const out: { key: string; lastModified: number }[] = [];
      for (const f of files) {
        if (!f.startsWith(base)) continue;
        const st = await fs.stat(path.join(dir, f));
        out.push({
          key: `${path.dirname(prefix)}/${f}`,
          lastModified: st.mtimeMs,
        });
      }
      return out;
    } catch {
      return [];
    }
  }
  async del(key: string): Promise<void> {
    try {
      await fs.unlink(path.join(this.dir, key));
    } catch {
      /* ignorar */
    }
  }
}

/** Bucket S3-compatible (Railway/Tigris o AWS S3). */
interface S3Config {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
}
class S3Backend implements Backend {
  private readonly client: S3Client;
  private readonly bucket: string;
  constructor(cfg: S3Config) {
    this.bucket = cfg.bucket;
    this.client = new S3Client({
      region: cfg.region,
      endpoint: cfg.endpoint,
      forcePathStyle: cfg.forcePathStyle ?? false,
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      },
    });
  }
  describe(): string {
    return `bucket(s3):${this.bucket}`;
  }
  async read(key: string): Promise<string | null> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return (await res.Body?.transformToString()) ?? null;
    } catch (err) {
      const name = (err as { name?: string }).name;
      if (name === "NoSuchKey" || name === "NotFound") return null;
      throw err;
    }
  }
  async write(key: string, data: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: data,
        ContentType: "application/json",
      }),
    );
  }
  async list(prefix: string): Promise<{ key: string; lastModified: number }[]> {
    const out: { key: string; lastModified: number }[] = [];
    let token: string | undefined;
    do {
      const r = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: token,
        }),
      );
      for (const o of r.Contents ?? []) {
        if (o.Key) {
          out.push({ key: o.Key, lastModified: o.LastModified?.getTime() ?? 0 });
        }
      }
      token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token);
    return out;
  }
  async del(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
}

function pickBackend(): Backend {
  const bucket = process.env.BUCKET_NAME;
  if (
    bucket &&
    process.env.BUCKET_ENDPOINT &&
    process.env.BUCKET_ACCESS_KEY_ID &&
    process.env.BUCKET_SECRET_ACCESS_KEY
  ) {
    return new S3Backend({
      bucket,
      region: process.env.BUCKET_REGION ?? "auto",
      endpoint: process.env.BUCKET_ENDPOINT,
      accessKeyId: process.env.BUCKET_ACCESS_KEY_ID!,
      secretAccessKey: process.env.BUCKET_SECRET_ACCESS_KEY!,
      forcePathStyle: true,
    });
  }
  const dir =
    process.env.DATA_DIR ??
    (process.env.RAILWAY_ENVIRONMENT ? "/data" : "./data");
  return new FsBackend(dir);
}

const backend = pickBackend();
export const storageInfo: string = backend.describe();

/** Destinos donde se escriben los snapshots raw (cada uno con su prefijo). */
interface SnapTarget {
  backend: Backend;
  prefix: string;
  name: string;
}
function snapshotTargets(): SnapTarget[] {
  // Railway (bucket actual): prefijo terremoto-vzla/raw/
  const targets: SnapTarget[] = [
    { backend, prefix: "terremoto-vzla/raw/", name: "railway" },
  ];
  // AWS S3 (bucket terremoto-vzla): prefijo raw/
  if (
    process.env.AWS_S3_BUCKET &&
    process.env.AWS_S3_ACCESS_KEY_ID &&
    process.env.AWS_S3_SECRET_ACCESS_KEY
  ) {
    targets.push({
      name: "aws",
      prefix: "raw/",
      backend: new S3Backend({
        bucket: process.env.AWS_S3_BUCKET,
        region: process.env.AWS_S3_REGION ?? "us-east-1",
        endpoint: process.env.AWS_S3_ENDPOINT,
        accessKeyId: process.env.AWS_S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_S3_SECRET_ACCESS_KEY,
        forcePathStyle: false,
      }),
    });
  }
  return targets;
}
const SNAP_TARGETS = snapshotTargets();

/**
 * Una sección de datos (desaparecidos, noticias, mapa). Cada una vive bajo su
 * propio prefijo en el bucket: `${name}/items.json`, `${name}/state.json`,
 * `${name}/changes/<runId>.json`.
 */
export class Section {
  constructor(public readonly name: string) {}
  private k(key: string): string {
    return `${this.name}/${key}`;
  }
  async loadItems<T = unknown>(): Promise<Record<string, T>> {
    const raw = await backend.read(this.k("items.json"));
    return raw ? (JSON.parse(raw) as Record<string, T>) : {};
  }
  /** Lee otro archivo de la sección (p. ej. "dtv-items.json"); null si no existe. */
  async loadOther<T = unknown>(
    filename: string,
  ): Promise<Record<string, T> | null> {
    const raw = await backend.read(this.k(filename));
    return raw ? (JSON.parse(raw) as Record<string, T>) : null;
  }
  async saveItems(items: Record<string, unknown>): Promise<void> {
    await backend.write(this.k("items.json"), JSON.stringify(items));
  }
  async writeChanges(runId: string, summary: unknown): Promise<void> {
    await backend.write(
      this.k(`changes/${runId}.json`),
      JSON.stringify(summary, null, 2),
    );
  }
  async writeState(state: unknown): Promise<void> {
    await backend.write(this.k("state.json"), JSON.stringify(state, null, 2));
  }
}

const SNAPSHOT_INTERVAL_HOURS = Number(process.env.SNAPSHOT_INTERVAL_HOURS ?? "24");
/** Fecha (epoch ms) embebida en el nombre: <tipo>_<YYYY-MM-DD_HH-mm>_<n>_jn.json */
const snapDate = (key: string): number | null => {
  const m = key.match(/_(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})_\d+(?:_jn)?\.json$/);
  return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:00Z`) : null;
};

/** Escribe el delta a UN target (cada bucket mantiene su propio baseline + deltas). */
async function writeDeltaToTarget(
  target: SnapTarget,
  fuente: string,
  tipo: string,
  items: unknown[],
): Promise<{ key?: string; cantidad: number; skipped?: string }> {
  const prefix = `${target.prefix}${fuente}/${tipo}_`;
  const existing = (await target.backend.list(prefix))
    .filter((o) => o.key.endsWith(".json"))
    .sort((a, b) => a.lastModified - b.lastModified);
  const latest = existing[existing.length - 1];
  const now = Date.now();
  const cutoff = latest ? (snapDate(latest.key) ?? latest.lastModified) : 0;

  if (latest) {
    const ageH = Math.max(0, now - cutoff) / 3_600_000;
    if (ageH < SNAPSHOT_INTERVAL_HOURS) {
      return { cantidad: 0, skipped: `intervalo (${ageH.toFixed(1)}h)` };
    }
  }
  const nuevos =
    cutoff === 0
      ? items
      : items.filter((it) => {
          const fsv = (it as { firstSeenAt?: string }).firstSeenAt;
          return fsv != null && Date.parse(fsv) > cutoff;
        });
  if (nuevos.length === 0) return { cantidad: 0, skipped: "sin-nuevos" };

  const fecha = new Date(now)
    .toISOString()
    .slice(0, 16)
    .replace("T", "_")
    .replace(/:/g, "-");
  const cantidad = nuevos.length;
  const key = `${prefix}${fecha}_${cantidad}_jn.json`; // sufijo _jn requerido
  await target.backend.write(
    key,
    JSON.stringify({
      fuente,
      tipo,
      extraidoEn: new Date(now).toISOString(),
      desde: cutoff ? new Date(cutoff).toISOString() : null,
      cantidad,
      items: nuevos,
    }),
  );
  return { key, cantidad };
}

/**
 * Snapshot DELTA escrito a TODOS los destinos (Railway + AWS S3 si hay credenciales).
 * Cada destino calcula su propio delta (firstSeenAt > último snapshot de ESE destino),
 * así un bucket nuevo arranca con su baseline completo y luego deltas chicos.
 * Nombre: <tipo>_<YYYY-MM-DD_HH-mm>_<cantidad>_jn.json
 */
export async function writeRawSnapshot(
  fuente: string,
  tipo: string,
  items: unknown[],
): Promise<{ cantidad: number }> {
  for (const target of SNAP_TARGETS) {
    try {
      const r = await writeDeltaToTarget(target, fuente, tipo, items);
      console.log(
        r.key
          ? `  raw[${target.name}] ${fuente}/${tipo}: delta ${r.cantidad}`
          : `  raw[${target.name}] ${fuente}/${tipo}: omitido (${r.skipped})`,
      );
    } catch (err) {
      console.warn(`  ! raw[${target.name}] ${fuente}/${tipo} falló: ${(err as Error).message}`);
    }
  }
  return { cantidad: items.length };
}
