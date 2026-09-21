// Credentials in the OS store (docs/specs/desktop-electron.md, "Install and
// sign in"). `safeStorage` encrypts with the Keychain on macOS, DPAPI on
// Windows and the desktop's secret service on Linux; the ciphertext lives in
// `secrets.json` under the profile's userData. The renderer only ever sees
// the decrypted values through the preload's in-memory mirror.
//
// When the OS store is unavailable (a Linux session with no secret service,
// a broken keychain), nothing is written: the preload keeps values in
// memory for the life of the process, and the person signs in again next
// launch. A plaintext token on disk is the one outcome this file exists to
// prevent.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { app, safeStorage } from 'electron';

const FILE = 'secrets.json';

export class SecretStore {
  private values = new Map<string, string>();
  private loaded = false;

  private get file(): string {
    return path.join(app.getPath('userData'), FILE);
  }

  get available(): boolean {
    return safeStorage.isEncryptionAvailable();
  }

  /** Every stored secret, decrypted. Read once at preload time. */
  load(): Record<string, string> {
    if (!this.loaded) {
      this.loaded = true;
      if (this.available) {
        try {
          const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, string>;
          for (const [key, encoded] of Object.entries(raw)) {
            try { this.values.set(key, safeStorage.decryptString(Buffer.from(encoded, 'base64'))); }
            catch { /* a value from another machine or user: skip it */ }
          }
        } catch { /* first run */ }
      }
    }
    return Object.fromEntries(this.values);
  }

  set(key: string, value: string): void {
    this.load();
    this.values.set(key, value);
    this.persist();
  }

  delete(key: string): void {
    this.load();
    this.values.delete(key);
    this.persist();
  }

  private persist(): void {
    if (!this.available) return;
    const out: Record<string, string> = {};
    for (const [key, value] of this.values) out[key] = safeStorage.encryptString(value).toString('base64');
    mkdirSync(path.dirname(this.file), { recursive: true });
    // Write-then-rename: a crash mid-write leaves the previous file intact.
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(out), { mode: 0o600 });
    renameSync(tmp, this.file);
  }
}
