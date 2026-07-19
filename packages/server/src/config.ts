import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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
  /** Local blob-store directory (phase2.md §3); object storage swaps in behind the same interface in phase 3. */
  get fileDir(): string {
    return process.env.FLOW_FILE_DIR ?? path.join(pkgRoot, '.files');
  },
  maxFileBytes: 20 * 1024 * 1024, // 20 MB/file (phase2.md §3)
  maxFilesPerMessage: 10,
  thumbMaxPx: 512,
  avatarPx: 512,
  orphanFileTtlHours: 24, // unattached files older than this are swept (decision log ruling 5)
} as const;
