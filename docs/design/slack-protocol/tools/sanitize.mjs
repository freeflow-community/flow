#!/usr/bin/env node
// Sanitize a raw capture-hook dump into committable fixtures (#544).
//
//   node sanitize.mjs <raw-dump.json> <out-dir> [--map map.json]
//
// The raw dump (from window.__flowCap.dump(), reassembled) stays OUTSIDE the
// repository. This script writes, under <out-dir>, one file per step mark
// (`NN-<label>.json`) holding the HTTP calls and socket frames observed between
// that mark and the next, plus `heartbeat.json` (ping/pong timing only) and
// `index.json` (marks, sockets, capture metadata).
//
// Rules:
//   - Slack IDs (U/W/C/D/G/T/E/B/F/S/A/L + alnum, and draft ids Dr…) -> stable
//     placeholders U_1, C_2 ... The id map is written to --map (default: next to
//     the raw dump), never to out-dir.
//   - Human text fields (text, name, real_name, display_name, email, title,
//     preview, snippet, ...) -> "<redacted>"; pref/telemetry blobs -> "<omitted>".
//   - URLs -> host + path (no query); workspace hostnames -> <workspace>.slack.com;
//     upload paths -> /upload/v1/<opaque>.
//   - Anything that still looks like a token fails the run.
//   - Message `ts`/`event_ts`/`thread_ts` strings are KEPT: they are the ordering
//     evidence, and the workspace is a test workspace with synthetic content.
//   - Noise endpoints (telemetry, edge-cache user hydration, surveys, prefs) are
//     listed by path only, without bodies. Duplicate inbound frames from a socket
//     that was registered twice (see meta.dedupeNote) are dropped.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const [rawPath, outDir, ...rest] = process.argv.slice(2);
if (!rawPath || !outDir) { console.error('usage: sanitize.mjs <raw.json> <out-dir> [--map map.json]'); process.exit(2); }
const mapPath = rest[0] === '--map' && rest[1] ? rest[1] : join(dirname(rawPath), 'id-map.json');
let idMap = {};
try { idMap = JSON.parse(readFileSync(mapPath, 'utf8')); } catch {}
const counters = {};
for (const v of Object.values(idMap)) { const [p, n] = v.split('_'); counters[p] = Math.max(counters[p] || 0, Number(n)); }

const ID_RE = /\b(Dr|[UWCDGTEBFSAL])([A-Z0-9]{8,12})\b/g;
const TOKEN_RE = /xox[a-z]-[A-Za-z0-9._-]+/g;
const TEXT_KEYS = /^(text|name|real_name|display_name|real_name_normalized|display_name_normalized|email|title|preview|snippet|first_name|last_name|phone|status_text|purpose|topic|fallback|pretext|domain|url_private|url_private_download|permalink|permalink_public|thumb_\w+|image_\d+|alt_text|filename|content|content_highlight_html|content_highlight_css|content_highlight_html_truncated|preview_highlight|lines|host_id|skype|username)$/;
const OMIT_KEYS = /^(logs|value|prefs|frecency|cached_latest_updates|latest_updates|unchanged_messages|payload|user_data|preserialized|js_initializer|init_options|import_map|notifications|results|content_highlight_css)$/;
const URL_KEYS = /url|link|src|href|image|avatar|icon/i;
const NOISE_PATH = /clog|beacon|megaphone|inprodsurveys|users\.prefs|experiments|canvas\/collab|onboarding|customStatus|calendar|workflows|aiApps|ublock|help\.|sfdc|targeting|reacji|saved\.list|permissions\/info|users\/info|users\/counts|huddles|api\.features|features\.access|sharedInvites|files\.collections|activity\.views|users\.interactions|dnd\./;
const NOISE_FRAME = /^(ping|pong|user_interaction_changed|reconnect_url)$/;

const placeholder = (prefix, id) => {
  const key = prefix + id;
  if (!idMap[key]) { counters[prefix] = (counters[prefix] || 0) + 1; idMap[key] = `${prefix}_${counters[prefix]}`; }
  return idMap[key];
};
const sanitizeString = (s, key) => {
  if (TEXT_KEYS.test(key || '')) return '<redacted>';
  if (OMIT_KEYS.test(key || '')) return '<omitted>';
  if (/token|secret|cookie/i.test(key || '')) return '<redacted>';
  if (key === 'blocks' || key === 'attachments' || key === 'files' || key === 'message_ids' || key === 'destinations') {
    try { return JSON.stringify(sanitize(JSON.parse(s))); } catch {}
  }
  let out = s.replace(TOKEN_RE, '<token>').replace(/\b[a-z0-9-]+\.slack\.com\b/g, (h) => (/^(edgeapi|app|files|wss-[a-z]+)\./.test(h) ? h : '<workspace>.slack.com'));
  if (/^(https?|wss):\/\//.test(out)) {
    try { const u = new URL(out); return /files\.slack\.com|slack-files|slack-imgs|slack-edge/.test(u.host) ? '<signed-url>' : `${u.host}${u.pathname.replace(ID_RE, (_, p, i) => placeholder(p, i))}`; } catch {}
  }
  if (URL_KEYS.test(key || '') && /:\/\//.test(out)) return '<url>';
  out = out.replace(/\/upload\/v1\/[A-Za-z0-9_-]+/, '/upload/v1/<opaque>').replace(ID_RE, (_, p, i) => placeholder(p, i));
  if (out.length > 600) out = out.slice(0, 600) + `…<${s.length} chars>`;
  return out;
};
const sanitize = (v, key) => {
  if (typeof v === 'string') return sanitizeString(v, key);
  if (Array.isArray(v)) return v.map((x) => sanitize(x, key));
  if (v && typeof v === 'object') {
    if (OMIT_KEYS.test(key || '')) return '<omitted>';
    const out = {};
    for (const [k, val] of Object.entries(v)) out[sanitizeString(k)] = sanitize(val, k);
    return out;
  }
  return v;
};

const raw = JSON.parse(readFileSync(rawPath, 'utf8'));
mkdirSync(outDir, { recursive: true });
const rel = (t) => (t == null ? null : Math.round(t - raw.t0));

// Merge "xhr-vals-only" records (form values captured by the second hook layer) into their request.
const httpRaw = [];
for (const r of raw.http || []) {
  if (r.via === 'xhr-vals-only') {
    const target = (raw.http || []).find((h) => h !== r && h.via === 'xhr' && h.url.path === r.url.path && Math.abs(h.t - r.t) < 50 && !h.formValues);
    if (target) { target.formValues = r.formValues; continue; }
  }
  httpRaw.push(r);
}
// A socket registered by two hook layers reports each inbound frame twice (same
// payload, different sock id, within a few ms). Keep the first copy only.
const seenIn = [];
const isDupIn = (f) => {
  if (f.dir !== 'in' || !f.json) return false;
  const key = JSON.stringify(f.json);
  const dup = seenIn.some((s) => s.key === key && Math.abs(s.t - f.t) < 50 && s.sock !== f.sock);
  seenIn.push({ key, t: f.t, sock: f.sock });
  return dup;
};

const shapeHttp = (r) => {
  const path = (r.url && r.url.path) || '';
  const noise = NOISE_PATH.test(path);
  return {
    t: rel(r.t), ms: r.tEnd ? r.tEnd - r.t : null, via: r.via, method: r.method, url: sanitize(r.url), status: r.status,
    form: noise ? undefined : r.form, formValues: noise ? undefined : sanitize(r.formValues),
    responseKeys: r.json && typeof r.json === 'object' ? Object.keys(r.json).sort() : null,
    response: noise ? '<noise endpoint, body omitted>' : sanitize(r.json),
  };
};
const shapeFrame = (f) => ({ t: rel(f.t), sock: f.sock, dir: f.dir, event: f.event, code: f.code, reason: f.reason, len: f.len, json: sanitize(f.json) });

const marks = (raw.marks || []).map((m) => ({ t: rel(m.t), label: m.label.replace(/coderbots/gi, 'workspace') }));
const frames = (raw.frames || []).filter((f) => !isDupIn(f));
const heartbeat = frames.filter((f) => f.json && /^(ping|pong)$/.test(f.json.type)).map((f) => ({ t: rel(f.t), sock: f.sock, dir: f.dir, type: f.json.type, id: f.json.id, reply_to: f.json.reply_to }));

const files = [];
marks.forEach((m, i) => {
  const end = marks[i + 1] ? marks[i + 1].t : Infinity;
  const inWin = (x) => rel(x.t) >= m.t && rel(x.t) < end;
  const http = httpRaw.filter(inWin).map(shapeHttp);
  const fr = frames.filter(inWin).filter((f) => !(f.json && NOISE_FRAME.test(f.json.type))).map(shapeFrame);
  if (!http.length && !fr.length) return;
  const name = `${String(i).padStart(2, '0')}-${m.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`;
  writeFileSync(join(outDir, name), JSON.stringify({ step: m.label, tStart: m.t, tEnd: end === Infinity ? null : end, http, frames: fr }, null, 1) + '\n');
  files.push({ file: name, step: m.label, http: http.length, frames: fr.length });
});
writeFileSync(join(outDir, 'heartbeat.json'), JSON.stringify(heartbeat, null, 1) + '\n');
writeFileSync(join(outDir, 'index.json'), JSON.stringify({
  observedOn: new Date(raw.t0).toISOString().slice(0, 10), userAgent: raw.ua,
  note: 'Sanitized by tools/sanitize.mjs: IDs are stable placeholders, human text and URLs redacted, tokens removed, telemetry/pref bodies omitted. Times are ms since capture start. See README.md for how each step was performed.',
  dedupeNote: 'Inbound frames duplicated by double socket registration were collapsed to one copy.', sockets: (raw.sockets || []).map((s) => ({ id: s.id, t: rel(s.t), origin: s.origin, url: sanitize(s.url) })), marks, files,
}, null, 1) + '\n');
writeFileSync(mapPath, JSON.stringify(idMap, null, 1) + '\n');

const leak = files.map((f) => join(outDir, f.file)).concat([join(outDir, 'index.json')]).filter((p) => { const s = readFileSync(p, 'utf8'); return TOKEN_RE.test(s) || /\b[a-z0-9-]+\.slack\.com\b/.test(s.replace(/<workspace>\.slack\.com|edgeapi\.slack\.com|app\.slack\.com|files\.slack\.com|wss-[a-z]+\.slack\.com/g, '')); });
if (leak.length) { console.error('token or hostname survived in', leak); process.exit(1); }
console.log(`wrote ${files.length} step files (${httpRaw.length} http, ${frames.length} frames) + heartbeat/index -> ${outDir}; id map -> ${mapPath}`);
