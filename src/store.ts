import { promises as fs } from "node:fs";
import path from "node:path";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";

/** Abstracción de almacenamiento: bucket S3 (Railway) o filesystem (Volume/local). */
interface Backend {
  read(key: string): Promise<string | null>;
  write(key: string, data: string): Promise<void>;
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
}

/** Railway Bucket (S3-compatible, sobre Tigris). */
class S3Backend implements Backend {
  private readonly client: S3Client;
  constructor(private readonly bucket: string) {
    this.client = new S3Client({
      region: process.env.BUCKET_REGION ?? "auto",
      endpoint: process.env.BUCKET_ENDPOINT,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.BUCKET_ACCESS_KEY_ID!,
        secretAccessKey: process.env.BUCKET_SECRET_ACCESS_KEY!,
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
}

function pickBackend(): Backend {
  const bucket = process.env.BUCKET_NAME;
  if (
    bucket &&
    process.env.BUCKET_ENDPOINT &&
    process.env.BUCKET_ACCESS_KEY_ID &&
    process.env.BUCKET_SECRET_ACCESS_KEY
  ) {
    return new S3Backend(bucket);
  }
  const dir =
    process.env.DATA_DIR ??
    (process.env.RAILWAY_ENVIRONMENT ? "/data" : "./data");
  return new FsBackend(dir);
}

const backend = pickBackend();
export const storageInfo: string = backend.describe();

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
