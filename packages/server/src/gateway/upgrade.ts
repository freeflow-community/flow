// Single HTTP-upgrade router. Two ws.WebSocketServer instances bound to the
// same HTTP server (gateway /v1/ws + socket-mode /api/socket-mode) can't both
// use the {server, path} option: each registers its own 'upgrade' listener
// and ws aborts any request whose path doesn't match ITS path (400) — the
// listeners kill each other's handshakes. So both run noServer and register
// here; one listener dispatches by pathname.
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import type { WebSocketServer } from 'ws';

const routers = new WeakMap<HttpServer, Map<string, WebSocketServer>>();

export function routeUpgrade(server: HttpServer, path: string, wss: WebSocketServer): void {
  let routes = routers.get(server);
  if (!routes) {
    routers.set(server, (routes = new Map()));
    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const url = req.url ?? '/';
      const qIndex = url.indexOf('?');
      const pathname = qIndex === -1 ? url : url.slice(0, qIndex);
      const target = routes!.get(pathname);
      if (!target) {
        socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      target.handleUpgrade(req, socket, head, (ws) => target.emit('connection', ws, req));
    });
  }
  routes.set(path, wss);
}
