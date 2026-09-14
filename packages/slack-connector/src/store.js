import { DatabaseSync } from 'node:sqlite';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// One process owns a database. Refuse a second owner at service startup (index.js).
// Only ciphertext is persisted: this includes OAuth transactions and event metadata.
export class Store {
  constructor(path, key) {
    this.key = Buffer.from(key, 'base64');
    if (this.key.length !== 32) throw new Error('CONNECTOR_KEY must encode 32 random bytes');
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS records (kind TEXT, id TEXT, value TEXT NOT NULL, PRIMARY KEY(kind,id))');
  }
  seal(kind, id, value) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(JSON.stringify([kind, id])));
    const body = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
  }
  open(kind, id, value) {
    const data = Buffer.from(value, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.key, data.subarray(0, 12));
    decipher.setAAD(Buffer.from(JSON.stringify([kind, id])));
    decipher.setAuthTag(data.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString());
  }
  get(kind, id) {
    const row = this.db.prepare('SELECT value FROM records WHERE kind=? AND id=?').get(kind, id);
    return row ? this.open(kind, id, row.value) : null;
  }
  put(kind, id, value) {
    this.db.prepare('INSERT OR REPLACE INTO records VALUES (?,?,?)').run(kind, id, this.seal(kind, id, value));
  }
  remove(kind, id) { this.db.prepare('DELETE FROM records WHERE kind=? AND id=?').run(kind, id); }
  all(kind) {
    return this.db.prepare('SELECT id,value FROM records WHERE kind=?').all(kind).map(row => ({ id: row.id, value: this.open(kind, row.id, row.value) }));
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  close() { this.db.close(); }
}
