import { buildApp } from './app.js';
import { config } from './config.js';
import { migrate } from './db/migrate.js';
import { closeDb } from './db/index.js';
import { initCrypto } from './crypto/index.js';
import { connectBus, closeBus } from './bus.js';
import { attachGateway } from './gateway/index.js';
import { attachSocketMode } from './gateway/socketMode.js';
import { purgeExpiredSessions } from './services/auth.js';
import { startOrphanSweep } from './services/files.js';
import { startAppEventsWorker } from './services/appEvents.js';

async function main(): Promise<void> {
  initCrypto();
  const applied = await migrate();
  const app = buildApp();
  if (applied.length) app.log.info({ applied }, 'migrations applied');

  await connectBus();
  await app.listen({ port: config.port, host: config.host });
  const gateway = attachGateway(app.server);
  const socketMode = attachSocketMode(app.server);
  app.log.info(`ws gateway attached at ws://${config.host}:${config.port}/v1/ws`);
  app.log.info(`socket-mode compat attached at ws://${config.host}:${config.port}/api/socket-mode`);

  if (process.env.FLOW_MIGRATE_BLOBS === '1') {
    // one-time volume → R2 copy; blocks boot-completion work but not serving
    const { runBlobMigration } = await import('./tools/migrateBlobsToR2.js');
    void runBlobMigration(app.log).catch((err) => app.log.error(err, 'blob migration failed'));
  }
  void purgeExpiredSessions().catch(() => {});
  startOrphanSweep(app.log); // boot-time + daily orphan-file sweep (decision log ruling 5)
  startAppEventsWorker(app.log); // Events API outbox drain (phase 4)

  const shutdown = async () => {
    gateway.close();
    socketMode.close();
    await app.close();
    await closeBus();
    await closeDb();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  // A stray unhandled rejection (e.g. from a socket/outbox delivery path)
  // must not silently cycle the container — log the full stack and keep
  // serving. An uncaught exception is less safe to swallow: log and let the
  // process exit so Railway restarts it cleanly (restart policy ON_FAILURE).
  process.on('unhandledRejection', (reason) => {
    app.log.error({ err: reason }, 'unhandledRejection (kept alive)');
  });
  process.on('uncaughtException', (err) => {
    app.log.error({ err }, 'uncaughtException (exiting for restart)');
    process.exit(1);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
