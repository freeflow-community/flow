import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Load the repo-root .env (Cloudflare credentials etc.) if present. Real env
// vars take precedence — loadEnvFile never overrides existing process.env.
const rootEnv = path.resolve(pkgRoot, '..', '..', '.env');
if (fs.existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export const config = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://flow:flow_dev@localhost:5442/flow',
  natsUrl: process.env.NATS_URL ?? 'nats://127.0.0.1:4222',
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? '127.0.0.1', // local server only in phase 1
  /** Sealed data-key file for local dev (KMS stand-in). Auto-created on first boot, chmod 600. */
  get dataKeyFile(): string {
    return process.env.FLOW_DATA_KEY_FILE ?? path.join(pkgRoot, '.keys', 'data.key.json');
  },
  /** Raw base64 data key override (tests/CI). Takes precedence over the file. */
  get dataKeyInline(): string | undefined {
    return process.env.FLOW_DATA_KEY;
  },
  inviteUrlBase: process.env.INVITE_URL_BASE ?? 'flow://invite/',
  sessionTtlDays: 30,
  inviteTtlDays: 7,
  // ---- email (verification + password reset) -------------------
  /** 'dev' logs + writes emails to emailOutboxDir; 'cloudflare' sends for real (deploy). */
  get emailDriver(): 'dev' | 'cloudflare' {
    return process.env.FLOW_EMAIL_DRIVER === 'cloudflare' ? 'cloudflare' : 'dev';
  },
  get emailFrom(): string {
    return process.env.FLOW_EMAIL_FROM ?? 'noreply@mail.flowtoo.org';
  },
  get cloudflareAccountId(): string | undefined {
    return process.env.CLOUDFLARE_ACCOUNT_ID;
  },
  get cloudflareApiToken(): string | undefined {
    return process.env.CLOUDFLARE_API_KEY;
  },
  /** Dev driver drops each sent email here as a JSON file (gitignored). */
  get emailOutboxDir(): string {
    return process.env.FLOW_EMAIL_OUTBOX ?? path.join(pkgRoot, '.emails');
  },
  /** Base URL the web client is served from — used in emailed links. */
  get webUrlBase(): string {
    return process.env.FLOW_WEB_URL ?? 'http://127.0.0.1:8787';
  },
  verifyTokenTtlHours: 48,
  resetTokenTtlMinutes: 60,
  signinTokenTtlMinutes: 15, // passwordless sign-in link — short-lived by design
  /** Local blob-store directory (phase2.md §3); object storage swaps in behind the same interface in phase 3. */
  get fileDir(): string {
    return process.env.FLOW_FILE_DIR ?? path.join(pkgRoot, '.files');
  },
  // ---- blob storage driver -------------------------------------
  /** 'local' stores under fileDir; 'r2' stores in Cloudflare R2 (S3 API) and enables presigned direct upload/download. */
  get blobDriver(): 'local' | 'r2' {
    return process.env.FLOW_BLOB_DRIVER === 'r2' ? 'r2' : 'local';
  },
  get r2Bucket(): string {
    return process.env.FLOW_R2_BUCKET ?? 'flow-files';
  },
  get r2Endpoint(): string | undefined {
    return process.env.CLOUDFLARE_S3_ENDPOINT;
  },
  get r2AccessKeyId(): string | undefined {
    return process.env.CLOUDFLARE_ACCESS_KEY_ID;
  },
  get r2SecretAccessKey(): string | undefined {
    return process.env.CLOUDFLARE_SECRET_ACCESS_KEY;
  },
  presignPutTtlSeconds: 15 * 60, // client has this long to finish a direct upload
  presignGetTtlSeconds: 5 * 60, // downloads: minted per-request after the access check
  maxFileBytes: 20 * 1024 * 1024, // 20 MB/file (phase2.md §3)
  maxFilesPerMessage: 10,
  thumbMaxPx: 512,
  avatarPx: 512,
  orphanFileTtlHours: 24, // unattached files older than this are swept (decision log ruling 5)
} as const;
