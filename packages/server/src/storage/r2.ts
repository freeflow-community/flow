// Cloudflare R2 blob driver (S3-compatible). New-flow blobs are stored as
// plaintext objects — R2 encrypts at rest, and access is gated by short-lived
// presigned URLs minted only after the normal permission checks (decision log,
// 2026-07-20 R2 ruling). Presigning is what makes direct client upload/download
// possible: the server never proxies the bytes.
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config.js';
import type { BlobStore, PresignedUpload } from './index.js';

export class R2Store implements BlobStore {
  private readonly client: S3Client;

  constructor(private readonly bucket: string) {
    const { r2Endpoint, r2AccessKeyId, r2SecretAccessKey } = config;
    if (!r2Endpoint || !r2AccessKeyId || !r2SecretAccessKey) {
      throw new Error(
        'FLOW_BLOB_DRIVER=r2 requires CLOUDFLARE_S3_ENDPOINT, CLOUDFLARE_ACCESS_KEY_ID and CLOUDFLARE_SECRET_ACCESS_KEY',
      );
    }
    this.client = new S3Client({
      region: 'auto',
      endpoint: r2Endpoint,
      credentials: { accessKeyId: r2AccessKeyId, secretAccessKey: r2SecretAccessKey },
    });
  }

  async put(key: string, data: Buffer): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data }));
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!res.Body) throw new Error(`empty body for storage key: ${key}`);
    return Buffer.from(await res.Body.transformToByteArray());
  }

  async delete(key: string): Promise<void> {
    // S3 DeleteObject is already idempotent (204 on missing keys)
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async head(key: string): Promise<{ size: number } | null> {
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: res.ContentLength ?? 0 };
    } catch (err) {
      if ((err as { name?: string }).name === 'NotFound') return null;
      throw err;
    }
  }

  async presignPut(key: string, opts: { contentType: string; contentLength: number }): Promise<PresignedUpload> {
    // ContentType/ContentLength become signed headers: the uploader must send
    // exactly these values or R2 rejects the PUT — this is how the 20 MB cap
    // survives the server never seeing the bytes.
    const cmd = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: opts.contentType,
      ContentLength: opts.contentLength,
    });
    const url = await getSignedUrl(this.client, cmd, { expiresIn: config.presignPutTtlSeconds });
    return { url, method: 'PUT', headers: { 'content-type': opts.contentType } };
  }

  async presignGet(
    key: string,
    opts: { filename?: string; contentType?: string; inline?: boolean; ttlSeconds?: number },
  ): Promise<string> {
    const disposition = opts.inline
      ? 'inline'
      : `attachment; filename*=UTF-8''${encodeURIComponent(opts.filename ?? 'file')}`;
    const cmd = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: disposition,
      ...(opts.contentType ? { ResponseContentType: opts.contentType } : {}),
    });
    return getSignedUrl(this.client, cmd, { expiresIn: opts.ttlSeconds ?? config.presignGetTtlSeconds });
  }
}
