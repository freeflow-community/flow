// Slack client observation hook (#544).
//
// Paste/inject into a signed-in Slack web client tab in a TEST workspace.
// It records, in page memory only:
//   - WebSocket frames both directions (the already-open socket is picked up
//     on its next send; new sockets are wrapped at construction)
//   - fetch()/XHR calls to *.slack.com and edgeapi: method path, query/form
//     field NAMES, status, and the (secret-redacted) JSON response
//   - step marks, so a UI action can be correlated with what followed
//
// Secrets are redacted before they are stored: any xox*-token, cookie
// headers, and fields named token/cookie/session. Socket URLs are reduced to
// host + path + sorted query parameter names. Nothing leaves the page until
// __flowCap.dump() is called; its output goes to a scratch directory and is
// run through tools/sanitize.mjs before anything is committed.
(() => {
  if (window.__flowCap) return 'already installed';
  const TOKEN_RE = /xox[a-z]-[A-Za-z0-9._-]+/g;
  const SECRET_KEYS = /^(token|cookie|set-cookie|authorization|session|d|d-s|x_token)$/i;

  const redactString = (s) => s.replace(TOKEN_RE, (m) => m.slice(0, 5) + 'REDACTED');
  const redact = (v, depth = 0) => {
    if (depth > 40) return '[depth]';
    if (typeof v === 'string') return redactString(v);
    if (Array.isArray(v)) return v.map((x) => redact(x, depth + 1));
    if (v && typeof v === 'object') {
      const out = {};
      for (const [k, val] of Object.entries(v)) out[k] = SECRET_KEYS.test(k) ? '[REDACTED]' : redact(val, depth + 1);
      return out;
    }
    return v;
  };
  const shapeUrl = (u) => {
    try {
      const url = new URL(u, location.href);
      return { host: url.host, path: url.pathname, query: [...url.searchParams.keys()].sort() };
    } catch { return { raw: redactString(String(u)).slice(0, 200) }; }
  };
  const bodyFieldNames = (body) => {
    if (!body) return null;
    if (body instanceof FormData) return [...body.keys()].sort();
    if (body instanceof URLSearchParams) return [...body.keys()].sort();
    if (typeof body === 'string') {
      try { return Object.keys(JSON.parse(body)).sort(); } catch {}
      try { return [...new URLSearchParams(body).keys()].sort(); } catch {}
      return ['<string>'];
    }
    return ['<' + (body.constructor && body.constructor.name) + '>'];
  };
  const parseMaybeJson = (s) => { try { return JSON.parse(s); } catch { return null; } };

  const cap = (window.__flowCap = {
    t0: Date.now(),
    frames: [], http: [], marks: [], sockets: [],
    mark(label) { cap.marks.push({ t: Date.now(), label }); return label; },
    size() { return { frames: cap.frames.length, http: cap.http.length, marks: cap.marks.length, sockets: cap.sockets.length }; },
    // Return a JSON string of everything since `sinceT` (ms epoch); `part`/`parts` slice it for transport.
    dump(sinceT = 0, part = 0, parts = 1) {
      const pick = (arr) => arr.filter((x) => x.t >= sinceT);
      const s = JSON.stringify({ t0: cap.t0, ua: navigator.userAgent, marks: pick(cap.marks), sockets: cap.sockets, http: pick(cap.http), frames: pick(cap.frames) });
      const n = Math.ceil(s.length / parts);
      return { part, parts, total: s.length, data: s.slice(part * n, (part + 1) * n) };
    },
    clear() { cap.frames.length = 0; cap.http.length = 0; cap.marks.length = 0; },
  });

  // ---- WebSocket ----
  const seen = new WeakSet();
  const attach = (ws, origin) => {
    if (seen.has(ws)) return;
    seen.add(ws);
    const id = cap.sockets.length + 1;
    cap.sockets.push({ id, t: Date.now(), origin, url: shapeUrl(ws.url), readyState: ws.readyState });
    ws.__flowCapId = id;
    ws.addEventListener('message', (ev) => {
      const data = typeof ev.data === 'string' ? ev.data : null;
      cap.frames.push({ t: Date.now(), sock: id, dir: 'in', kind: data ? 'text' : (ev.data && ev.data.constructor.name), len: data ? data.length : (ev.data && ev.data.size) || null, json: data ? redact(parseMaybeJson(data)) : null, raw: data && !parseMaybeJson(data) ? redactString(data).slice(0, 500) : undefined });
    });
    ws.addEventListener('open', () => cap.frames.push({ t: Date.now(), sock: id, dir: 'meta', event: 'open' }));
    ws.addEventListener('close', (ev) => cap.frames.push({ t: Date.now(), sock: id, dir: 'meta', event: 'close', code: ev.code, reason: redactString(ev.reason || ''), wasClean: ev.wasClean }));
    ws.addEventListener('error', () => cap.frames.push({ t: Date.now(), sock: id, dir: 'meta', event: 'error' }));
  };
  const origSend = WebSocket.prototype.send;
  WebSocket.prototype.send = function (data) {
    attach(this, 'existing-on-send');
    const s = typeof data === 'string' ? data : null;
    cap.frames.push({ t: Date.now(), sock: this.__flowCapId, dir: 'out', kind: s ? 'text' : (data && data.constructor.name), len: s ? s.length : null, json: s ? redact(parseMaybeJson(s)) : null, raw: s && !parseMaybeJson(s) ? redactString(s).slice(0, 500) : undefined });
    return origSend.call(this, data);
  };
  const OrigWS = window.WebSocket;
  const WrappedWS = function (url, protocols) {
    const ws = protocols === undefined ? new OrigWS(url) : new OrigWS(url, protocols);
    attach(ws, 'constructed');
    return ws;
  };
  WrappedWS.prototype = OrigWS.prototype;
  for (const k of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) WrappedWS[k] = OrigWS[k];
  window.WebSocket = WrappedWS;

  // ---- fetch ----
  const interesting = (u) => /slack\.com|slack-edge\.com|slack-imgs\.com/.test(u);
  const origFetch = window.fetch;
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : input && input.url;
    const rec = interesting(String(url)) ? { t: Date.now(), via: 'fetch', method: (init && init.method) || (input && input.method) || 'GET', url: shapeUrl(url), form: bodyFieldNames(init && init.body) } : null;
    const res = await origFetch.call(this, input, init);
    if (rec) {
      rec.status = res.status;
      rec.tEnd = Date.now();
      rec.contentType = res.headers.get('content-type');
      cap.http.push(rec);
      if (/json/.test(rec.contentType || '')) {
        try { res.clone().text().then((txt) => { rec.json = redact(parseMaybeJson(txt)); rec.len = txt.length; }); } catch {}
      }
    }
    return res;
  };

  // ---- XHR ----
  const xo = XMLHttpRequest.prototype.open, xs = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) { this.__flowCapUrl = String(url); this.__flowCapMethod = method; return xo.call(this, method, url, ...rest); };
  XMLHttpRequest.prototype.send = function (body) {
    if (interesting(this.__flowCapUrl || '')) {
      const rec = { t: Date.now(), via: 'xhr', method: this.__flowCapMethod, url: shapeUrl(this.__flowCapUrl), form: bodyFieldNames(body) };
      this.addEventListener('loadend', () => {
        rec.status = this.status; rec.tEnd = Date.now(); rec.contentType = this.getResponseHeader('content-type');
        if (this.responseType === '' || this.responseType === 'text') { rec.len = (this.responseText || '').length; rec.json = redact(parseMaybeJson(this.responseText)); }
        else if (this.responseType === 'json') rec.json = redact(this.response);
        cap.http.push(rec);
      });
    }
    return xs.call(this, body);
  };
  return 'installed';
})();
