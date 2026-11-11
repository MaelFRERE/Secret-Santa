import http from 'node:http';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {createStorage, displayName} from './storage.js';

const PORT = Number(process.env.PORT || 3000);
const ADMIN_CODE = process.env.ADMIN_CODE;
if (!ADMIN_CODE) { console.error('Configurez ADMIN_CODE avant de d\u00e9marrer.'); process.exit(1); }
let store;
try { store = await createStorage(); }
catch (error) {
  console.error(error.message.startsWith('DATABASE_URL manquante') ? error.message :
    'Sauvegarde inaccessible : v\u00e9rifiez DATABASE_URL, la connexion et les donn\u00e9es. Aucune r\u00e9initialisation effectu\u00e9e.');
  process.exit(1);
}
const html = await fs.readFile(new URL('./index.html', import.meta.url));
class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new ApiError(status, message); };
const headers = {
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
};
function send(res, status, data) {
  res.writeHead(status, {...headers, 'Content-Type': 'application/json; charset=utf-8'});
  res.end(JSON.stringify(data));
}
async function body(req) {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 16384) fail(413, 'Requ\u00eate trop longue.');
    chunks.push(chunk);
  }
  let data;
  try { data = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { fail(400, 'Requ\u00eate JSON invalide.'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail(400, 'Requ\u00eate invalide.');
  return data;
}
function names(payload) {
  const clean = v => typeof v === 'string' ? v.normalize('NFC').trim().replace(/\s+/g, ' ') : '';
  const firstName = clean(payload.firstName), lastName = clean(payload.lastName);
  if (firstName.length < 2 || firstName.length > 40) fail(400, 'Pr\u00e9nom entre 2 et 40 caract\u00e8res.');
  if (!lastName || lastName.length > 40) fail(400, 'Nom entre 1 et 40 caract\u00e8res.');
  return {firstName, lastName, name: `${firstName} ${lastName}`};
}
function findParticipant(db, token) {
  if (typeof token !== 'string' || !token || token.length > 256) fail(403, 'Lien personnel invalide.');
  const p = db.participants.find(p => p.token === token);
  if (!p) fail(403, 'Ce lien personnel n\u2019est pas reconnu par cette base. Il reste conserv\u00e9 sur ton appareil.');
  return p;
}
function checkName(db, identity, except) {
  if (db.participants.some(p => p !== except && displayName(p).toLocaleLowerCase('fr') === identity.name.toLocaleLowerCase('fr'))) {
    fail(409, 'Cette personne est d\u00e9j\u00e0 inscrite. Utilise son lien personnel.');
  }
}
function requireAdmin(req) {
  const provided = Buffer.from(String(req.headers['x-admin-code'] || ''));
  const expected = Buffer.from(ADMIN_CODE);
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) fail(403, 'Code organisateur incorrect.');
}
function profile(p, drawn) {
  return {name: displayName(p), firstName: p.firstName || p.name || '', lastName: p.lastName || '', drawn, recipient: drawn ? p.recipient : null};
}
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, {...headers, 'Content-Type': 'text/html; charset=utf-8'});
      return res.end(html);
    }
    // Liveness only: frequent health checks must not keep an idle external database awake.
    if (req.method === 'GET' && url.pathname === '/healthz') return send(res, 200, {ok: true});
    if (req.method === 'GET' && url.pathname === '/api/state') {
      const db = await store.read();
      return send(res, 200, {participants: db.participants.map(displayName), drawn: db.drawn, storage: store.kind});
    }
    if (req.method === 'POST' && url.pathname === '/api/join') {
      const payload = await body(req);
      const identity = names(payload);
      // The browser saves this secret BEFORE the request, so a lost response can be retried safely.
      if (payload.registrationToken !== undefined && (typeof payload.registrationToken !== 'string' || !/^[a-f0-9]{48}$/.test(payload.registrationToken))) {
        fail(400, 'Cl\u00e9 d\u2019inscription invalide.');
      }
      const secret = payload.registrationToken || crypto.randomBytes(24).toString('hex');
      const result = await store.update(db => {
        const existing = db.participants.find(p => p.token === secret);
        if (existing) return {...profile(existing, db.drawn), token: existing.token};
        if (db.drawn) fail(409, 'Les inscriptions sont ferm\u00e9es.');
        checkName(db, identity);
        const p = {...identity, token: secret, recipient: null};
        db.participants.push(p);
        return {...profile(p, false), token: p.token};
      });
      return send(res, 200, result);
    }
    if (req.method === 'POST' && url.pathname === '/api/profile') {
      const payload = await body(req);
      const identity = names(payload);
      const result = await store.update(db => {
        const p = findParticipant(db, payload.token);
        if (db.drawn) fail(409, 'Les modifications sont ferm\u00e9es apr\u00e8s le tirage.');
        checkName(db, identity, p);
        Object.assign(p, identity);
        return profile(p, false);
      });
      return send(res, 200, result);
    }
    if (req.method === 'POST' && url.pathname === '/api/draw') {
      requireAdmin(req);
      await body(req);
      const result = await store.update(db => {
        if (db.drawn) fail(409, 'Tirage d\u00e9j\u00e0 effectu\u00e9.');
        if (db.participants.length < 2) fail(400, 'Il faut au moins deux participants.');
        const order = db.participants.slice();
        for (let i = order.length - 1; i > 0; i--) {
          const j = crypto.randomInt(i + 1);
          [order[i], order[j]] = [order[j], order[i]];
        }
        for (let i = 0; i < order.length; i++) order[i].recipient = displayName(order[(i + 1) % order.length]);
        db.drawn = true;
        return {ok: true};
      });
      return send(res, 200, result);
    }
    if (req.method === 'POST' && url.pathname === '/api/result') {
      const payload = await body(req);
      const db = await store.read();
      return send(res, 200, profile(findParticipant(db, payload.token), db.drawn));
    }
    return send(res, 404, {error: 'Page introuvable.'});
  } catch (error) {
    if (error instanceof ApiError) return send(res, error.status, {error: error.message});
    // A database outage is NOT an invalid personal link and must never delete a session.
    console.error('Requ\u00eate interrompue : stockage indisponible.');
    return send(res, 503, {error: 'La sauvegarde est temporairement indisponible. Ton lien est conserv\u00e9 ; r\u00e9essaie dans un instant.', code: 'STORAGE_UNAVAILABLE'});
  }
});
server.listen(PORT, '0.0.0.0', () => console.log(`Secret Santa actif sur le port ${PORT}. Stockage : ${store.kind}.`));
let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  const timer = setTimeout(() => process.exit(1), 25000);
  timer.unref();
  server.close(async () => { await store.close(); clearTimeout(timer); });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
