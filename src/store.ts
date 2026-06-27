import { promises as fs } from "node:fs";
import path from "node:path";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import type { Report } from "./types.js";

export type Store = Record<string, Report>;

const REPORTS_KEY = "reports.json";
const STATE_KEY = "state.json";
const changesKey = (runId: string): string => `changes/${runId}.json`;

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
      region: process.env.BUCKET_REGION ?? "us-east-1",
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

/** Usa el bucket si están sus variables; si no, filesystem. */
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

export async function loadStore(): Promise<Store> {
  const raw = await backend.read(REPORTS_KEY);
  return raw ? (JSON.parse(raw) as Store) : {};
}

export async function saveStore(store: Store): Promise<void> {
  await backend.write(REPORTS_KEY, JSON.stringify(store));
}

export async function writeChanges(
  runId: string,
  summary: unknown,
): Promise<void> {
  await backend.write(changesKey(runId), JSON.stringify(summary, null, 2));
}

export async function writeState(state: unknown): Promise<void> {
  await backend.write(STATE_KEY, JSON.stringify(state, null, 2));
}
