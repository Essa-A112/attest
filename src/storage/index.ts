import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Blob storage for uploaded policy source files. Production uses Cloudflare R2
 * (S3-compatible, configured via R2_* env vars); dev and CI fall back to the
 * local filesystem under .uploads/. Keys, not URLs, are stored in the DB —
 * source files are private evidence, never publicly addressable.
 */
export interface BlobStorage {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
}

const LOCAL_DIR = path.join(process.cwd(), ".uploads");

class LocalStorage implements BlobStorage {
  async put(key: string, bytes: Uint8Array): Promise<void> {
    const file = path.join(LOCAL_DIR, key);
    if (!file.startsWith(LOCAL_DIR + path.sep)) throw new Error("invalid storage key");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
  }

  async get(key: string): Promise<Uint8Array> {
    const file = path.join(LOCAL_DIR, key);
    if (!file.startsWith(LOCAL_DIR + path.sep)) throw new Error("invalid storage key");
    return new Uint8Array(await readFile(file));
  }
}

class R2Storage implements BlobStorage {
  constructor(
    private readonly endpoint: string,
    private readonly bucket: string,
    private readonly accessKeyId: string,
    private readonly secretAccessKey: string,
  ) {}

  private async client() {
    // Lazy import keeps the AWS SDK out of dev/test bundles entirely.
    const { S3Client, PutObjectCommand, GetObjectCommand } = await import(
      "@aws-sdk/client-s3"
    );
    const client = new S3Client({
      region: "auto",
      endpoint: this.endpoint,
      credentials: {
        accessKeyId: this.accessKeyId,
        secretAccessKey: this.secretAccessKey,
      },
    });
    return { client, PutObjectCommand, GetObjectCommand };
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    const { client, PutObjectCommand } = await this.client();
    await client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType,
      }),
    );
  }

  async get(key: string): Promise<Uint8Array> {
    const { client, GetObjectCommand } = await this.client();
    const res = await client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!res.Body) throw new Error(`empty body for storage key ${key}`);
    return res.Body.transformToByteArray();
  }
}

export function getStorage(): BlobStorage {
  const { R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
  if (R2_ENDPOINT && R2_BUCKET && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY) {
    return new R2Storage(R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY);
  }
  if (process.env.NODE_ENV === "production" && process.env.VERCEL) {
    throw new Error("R2 storage must be configured in production");
  }
  return new LocalStorage();
}
