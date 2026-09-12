import { mkdirSync, openSync, closeSync, unlinkSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Store } from './store.js';
import { Connector } from './connector.js';
import { createConnectorServer } from './http.js';

const required = name => { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value; };
const origin = value => {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password) throw new Error('Connector and client origins must be exact HTTPS origins');
  return value;
};
// Native clients name themselves with the app's URL scheme (flow://slack) and
// return there after Slack's consent page (#546); browsers stay exact HTTPS.
const clientOrigin = value => (/^flow:\/\/[a-z0-9.-]+$/i.test(value) ? value : origin(value));
const config = {
  clientId: required('SLACK_CLIENT_ID'), clientSecret: required('SLACK_CLIENT_SECRET'), signingSecret: required('SLACK_SIGNING_SECRET'),
  publicOrigin: origin(required('CONNECTOR_ORIGIN')),
  clientOrigins: required('CONNECTOR_CLIENT_ORIGINS').split(',').map(clientOrigin),
};
const key = required('CONNECTOR_KEY');
const path = resolve(required('CONNECTOR_DB'));
mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
// One writer owns refresh serialization. No horizontal replicas with this store.
// A stale lock after a crash requires explicit operator recovery.
// `CONNECTOR_LOCK=none` skips the file lock on a host that already guarantees
// one container per volume (Railway): there a lock left behind by a killed
// container would block every restart, and it protects against nothing.
const lockPath = `${path}.lock`;
const lock = process.env.CONNECTOR_LOCK === 'none' ? null : openSync(lockPath, 'wx', 0o600);
process.umask(0o077);
const store = new Store(path, key);
chmodSync(path, 0o600);
const connector = new Connector({ ...config, store });
const server = createConnectorServer(connector);
server.requestTimeout = 20_000;
server.headersTimeout = 10_000;
const sweep = setInterval(() => connector.sweep(), 60_000).unref();
// Loopback by default (an HTTPS proxy on the same host); `HOST=0.0.0.0` where
// the platform's edge terminates TLS and reaches the container over its own
// network, as Railway does.
server.listen(Number(process.env.PORT ?? 8790), process.env.HOST ?? '127.0.0.1', () => console.log('Slack connector listening'));
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  if (stopping) return;
  stopping = true;
  clearInterval(sweep);
  server.close(() => { store.close(); if (lock !== null) { closeSync(lock); unlinkSync(lockPath); } });
});
