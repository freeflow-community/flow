import { buildApp } from './app.js';
import { config } from './config.js';
import { migrate } from './db/migrate.js';
import { closeDb } from './db/index.js';
import { initCrypto } from './crypto/index.js';
import { connectBus, closeBus } from './bus.js';
import { attachGateway } from './gateway/index.js';
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
  app.log.info(`ws gateway attached at ws://${config.host}:${config.port}/v1/ws`);

  void purgeExpiredSessions().catch(() => {});
  startOrphanSweep(app.log); // boot-time + daily orphan-file sweep (decision log ruling 5)
  startAppEventsWorker(app.log); // Events API outbox drain (phase 4)

  const shutdown = async () => {
    gateway.close();
    await app.close();
    await closeBus();
    await closeDb();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
