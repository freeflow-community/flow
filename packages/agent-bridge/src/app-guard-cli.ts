// `flow-agent-bridge app-guard --upstream http://localhost:3000 --port 8788`
// — argument parsing and startup for the mini-app guard (see app-guard.ts for
// what it actually does). Kept apart from the guard itself so the proxy can be
// tested without a process.
import { AppGuard, parseSecretList } from './app-guard.js';

export interface AppGuardCliOptions {
  upstream: string;
  port: number;
  host: string;
  secrets: string[];
}

export class AppGuardUsageError extends Error {}

/** Parse `app-guard`'s flags. `secrets` comes from the environment, never the
 * command line — a secret in argv is a secret in `ps` output. */
export function parseAppGuardArgs(args: string[], env: NodeJS.ProcessEnv): AppGuardCliOptions {
  const flag = (name: string): string | undefined => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const upstream = flag('upstream');
  if (!upstream) throw new AppGuardUsageError('app-guard needs --upstream (e.g. http://localhost:3000)');
  const portRaw = flag('port') ?? '8788';
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new AppGuardUsageError(`--port must be a port number, got ${portRaw}`);
  }
  const secrets = parseSecretList(env.FLOW_APP_SECRET);
  if (secrets.length === 0) {
    throw new AppGuardUsageError(
      'set FLOW_APP_SECRET to the secret create_artifact returned (several, comma-separated, when the app is pinned in more than one channel)',
    );
  }
  return { upstream, port, host: flag('host') ?? '0.0.0.0', secrets };
}

export async function runAppGuard(args: string[], env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const opts = parseAppGuardArgs(args, env);
  // Every way the guard can fail to come up is a misconfiguration the operator
  // has to fix, so they all leave by the same door: one line, exit 2.
  let guard: AppGuard;
  try {
    guard = new AppGuard({ upstream: opts.upstream, secrets: opts.secrets });
  } catch (err) {
    throw new AppGuardUsageError((err as Error).message);
  }
  try {
    await guard.listen(opts.port, opts.host);
  } catch (err) {
    // A busy port is the common one, and a node stack trace is a bad way to
    // learn that another guard is already running.
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'EADDRINUSE') throw new AppGuardUsageError(`port ${opts.port} is already in use — pass a different --port`);
    if (e.code === 'EACCES') throw new AppGuardUsageError(`not allowed to listen on port ${opts.port} — pick one above 1024`);
    throw err;
  }
  const port = (guard.server.address() as { port: number }).port;
  console.error(
    `app-guard: :${port} → ${opts.upstream} (${opts.secrets.length} secret${opts.secrets.length === 1 ? '' : 's'}). ` +
      'Tunnel this port, not the app’s.',
  );
  const stop = (): void => {
    void guard.close().then(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
