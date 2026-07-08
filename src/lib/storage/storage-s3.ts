/**
 * S3-compatible storage backend (MinIO in production).
 *
 * Activated by setting STORAGE_DRIVER=s3 plus the S3_* env vars.
 * Uses dynamic imports so the AWS SDK is only required when actually needed —
 * the local-dev experience stays dependency-free.
 *
 * On the mini-PC, install:
 *   bun add @aws-sdk/client-s3 @aws-sdk/lib-storage
 */

import { Readable } from "node:stream";
import type { ReadableStream } from "node:stream/web";
import { createHash } from "node:crypto";
import type { StorageBackend, UploadResult } from "./index";

export interface S3Config {
  endpoint: string;
  region: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
  forcePathStyle?: boolean;
}

export class S3FileStorage implements StorageBackend {
  private clientPromise: Promise<any> | null = null;
  private readonly bucket: string;
  private readonly cfg: S3Config;

  constructor(cfg: S3Config) {
    this.cfg = cfg;
    this.bucket = cfg.bucket;
  }

  private async getClient() {
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        const [{ S3Client }, { Upload }] = await Promise.all([
          import("@aws-sdk/client-s3"),
          import("@aws-sdk/lib-storage"),
        ]);
        const client = new S3Client({
          endpoint: this.cfg.endpoint,
          region: this.cfg.region,
          credentials: {
            accessKeyId: this.cfg.accessKey,
            secretAccessKey: this.cfg.secretKey,
          },
          forcePathStyle: this.cfg.forcePathStyle ?? true,
        });
        return { client, Upload };
      })();
    }
    return this.clientPromise;
  }

  async put(
    key: string,
    data: Buffer | Readable | ReadableStream<Uint8Array>
  ): Promise<UploadResult> {
    const { client, Upload } = await this.getClient();
    const hash = createHash("sha256");
    let sizeBytes = 0;

    let body: Readable | Buffer;
    if (Buffer.isBuffer(data)) {
      hash.update(data);
      sizeBytes = data.byteLength;
      body = data;
    } else {
      const nodeStream = (data as ReadableStream<Uint8Array>).getReader
        ? Readable.fromWeb(data as ReadableStream<Uint8Array>)
        : (data as Readable);
      // Wrap the source so we can hash + count bytes as they flow through.
      const { PassThrough } = await import("node:stream");
      const passthrough = new PassThrough();
      nodeStream.on("data", (chunk: Buffer) => {
        hash.update(chunk);
        sizeBytes += chunk.byteLength;
      });
      nodeStream.pipe(passthrough);
      body = passthrough;
    }

    const upload = new Upload({
      client,
      params: { Bucket: this.bucket, Key: key, Body: body },
    });
    await upload.done();

    return { storageKey: key, sizeBytes, hashSha256: hash.digest("hex") };
  }

  async get(key: string): Promise<Readable> {
    const { client } = await this.getClient();
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const res = await client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return res.body as Readable;
  }

  async getBuffer(key: string): Promise<Buffer> {
    const stream = await this.get(key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  }

  async delete(key: string): Promise<void> {
    const { client } = await this.getClient();
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    await client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async stat(key: string): Promise<{ size: number; mtime: Date }> {
    const { client } = await this.getClient();
    const { HeadObjectCommand } = await import("@aws-sdk/client-s3");
    const res = await client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
    return {
      size: res.ContentLength ?? 0,
      mtime: res.LastModified ?? new Date(),
    };
  }
}
