import http from 'node:http';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import net from 'node:net';
import webpush from 'web-push';
import {createStorage, displayName} from './storage.js';

const PORT = Number(process.env.PORT || 3000);
const ADMIN_CODE = process.env.ADMIN_CODE;
if (!ADMIN_CODE) { console.error('Configurez ADMIN_CODE avant de démarrer.'); process.exit(1); }
let store;
try { store = await createStorage(); }
catch (error) {
  console.error(error.message.startsWith('DATABASE_URL manquante') ? error.message :
    'Sauvegarde inaccessible : vérifiez DATABASE_URL et la connexion Neon. Les données n’ont pas été réinitialisées.');
  process.exit(1);
}

// Les clés Web Push sont générées une seule fois et conservées dans Neon.
// Ainsi, aucune configuration supplémentaire n’est nécessaire sur Render.
let vapid;
try {
  vapid = await store.update(db => {
    if (!db.pushVapid) db.pushVapid = webpush.generateVAPIDKeys();
    return {...db.pushVapid};
  });
  const subject = process.env.VAPID_SUBJECT || process.env.RENDER_EXTERNAL_URL || 'https://example.org';
  if (!/^(https:\/\/[^\s]+|mailto:[^\s@]+@[^\s@]+)$/i.test(subject)) throw new Error('VAPID_SUBJECT invalide');
  webpush.setVapidDetails(subject, vapid.publicKey, vapid.privateKey);
} catch {
  console.error('Impossible d’initialiser les notifications Web Push. La sauvegarde est préservée.');
  await store.close();
  process.exit(1);
}

const staticFiles = new Map();
for (const [route, filename, type] of [
  ['/', 'index.html', 'text/html; charset=utf-8'],
  ['/index.html', 'index.html', 'text/html; charset=utf-8'],
  ['/styles.css', 'styles.css', 'text/css; charset=utf-8'],
  ['/app.js', 'app.js', 'text/javascript; charset=utf-8'],
  ['/sw.js', 'sw.js', 'text/javascript; charset=utf-8'],
  ['/icon.svg', 'icon.svg', 'image/svg+xml'],
  ['/icon-192.png', 'icon-192.png', 'image/png'],
  ['/icon-512.png', 'icon-512.png', 'image/png']
]) staticFiles.set(route, {content: await fs.readFile(new URL(filename, import.meta.url)), type});

class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new ApiError(status, message); };
// Limite les recherches en masse. Cette mesure ne remplace pas une authentification :
// connaître un prénom et un nom reste suffisant pour accéder à un tirage.
const recoveryAttempts = new Map();
function throttleRecovery(req) {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const forwarded = req.headers['x-forwarded-for'];
  const ip = (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : req.socket.remoteAddress) || 'unknown';
  const existing = recoveryAttempts.get(ip);
  const attempts = existing && now - existing.start < windowMs ? existing : {start: now, count: 0};
  if (++attempts.count > 60) fail(429, 'Trop de recherches. Réessaie un peu plus tard.');
  recoveryAttempts.set(ip, attempts);
  if (recoveryAttempts.size > 2000) {
    for (const [key, value] of recoveryAttempts) if (now - value.start >= windowMs) recoveryAttempts.delete(key);
  }
}
const securityHeaders = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
};
function send(res, status, data) {
  res.writeHead(status, {...securityHeaders, 'Content-Type': 'application/json; charset=utf-8'});
  res.end(JSON.stringify(data));
}
async function body(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 16384) fail(413, 'Requête trop longue.');
    chunks.push(chunk);
  }
  let data;
  try { data = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { fail(400, 'Requête JSON invalide.'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail(400, 'Requête invalide.');
  return data;
}
function names(payload) {
  const clean = v => typeof v === 'string' ? v.normalize('NFC').trim().replace(/\s+/g, ' ') : '';
  const firstName = clean(payload.firstName), lastName = clean(payload.lastName);
  if (firstName.length < 2 || firstName.length > 40) fail(400, 'Prénom : 2 à 40 caractères.');
  if (!lastName || lastName.length > 40) fail(400, 'Nom : 1 à 40 caractères.');
  return {firstName, lastName, name: `${firstName} ${lastName}`};
}
function findParticipant(db, token) {
  if (typeof token !== 'string' || !token || token.length > 256) fail(403, 'Lien personnel invalide.');
  const p = db.participants.find(p => p.token === token);
  if (!p) fail(403, 'Inscription introuvable. Demande à l’organisateur si elle a été supprimée.');
  return p;
}
function searchRegisteredName(db, identity) {
  const lower = value => value.normalize('NFC').toLocaleLowerCase('fr');
  // D'abord exact (sauf majuscules). Les accents ne sont ignorés qu'en recours.
  const exact = db.participants.filter(p => lower(displayName(p)) === lower(identity.name));
  if (exact.length === 1) return exact[0];
  const basic = value => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('fr');
  const approximate = db.participants.filter(p => basic(displayName(p)) === basic(identity.name));
  if (approximate.length > 1) fail(409, 'Plusieurs inscriptions correspondent à ce nom. Contacte l’organisateur.');
  if (!approximate.length) fail(404, 'Inscription introuvable. Vérifie ton prénom et ton nom.');
  return approximate[0];
}
function checkName(db, identity, except) {
  if (db.participants.some(p => p !== except && displayName(p).toLocaleLowerCase('fr') === identity.name.toLocaleLowerCase('fr'))) {
    fail(409, 'Cette personne est déjà inscrite.');
  }
}
function requireAdmin(req) {
  const given = req.headers['x-admin-code'];
  if (typeof given !== 'string' || given.length > 512) fail(403, 'Code organisateur incorrect.');
  const provided = Buffer.from(given);
  const expected = Buffer.from(ADMIN_CODE);
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) fail(403, 'Code organisateur incorrect.');
}
function profile(p, drawn) {
  return {name: displayName(p), firstName: p.firstName || p.name || '', lastName: p.lastName || '', drawn, recipient: drawn ? p.recipient : null};
}
function participantId(p) { return crypto.createHash('sha256').update(p.token).digest('hex').slice(0, 24); }
function adminParticipant(p) {
  return {id: participantId(p), name: displayName(p), firstName: p.firstName, lastName: p.lastName,
    pushDevices: (p.pushSubscriptions || []).length,
    pushAccepted: (p.pushSubscriptions || []).filter(s => s.sentAt).length};
}
function adminOverview(db) {
  return {drawn: db.drawn, participants: db.participants.map(adminParticipant), storage: store.kind};
}
function findAdminParticipant(db, id) {
  if (typeof id !== 'string' || !/^[a-f0-9]{24}$/.test(id)) fail(400, 'Participant invalide.');
  const p = db.participants.find(p => participantId(p) === id);
  if (!p) fail(404, 'Ce participant n’existe plus. Actualise la liste.');
  return p;
}
function validateSubscription(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof raw.endpoint !== 'string' || raw.endpoint.length > 2048) {
    fail(400, 'Abonnement de notification invalide.');
  }
  let url;
  try { url = new URL(raw.endpoint); }
  catch { fail(400, 'Adresse de notification invalide.'); }
  if (url.protocol !== 'https:' || !url.hostname.includes('.') || net.isIP(url.hostname) ||
      url.username || url.password || url.port || /\.(local|internal|localhost)$/i.test(url.hostname)) {
    fail(400, 'Service de notification non autorisé.');
  }
  const keys = raw.keys;
  if (!keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string' ||
      !/^[\w-]{60,160}$/.test(keys.p256dh) || !/^[\w-]{10,80}$/.test(keys.auth)) {
    fail(400, 'Clés de notification invalides.');
  }
  return {endpoint: raw.endpoint, keys: {p256dh: keys.p256dh, auth: keys.auth}, sentAt: null, attempts: 0, lastAttemptAt: null};
}

let sendingPush = false;
let lastPushScanAt = 0;
function kickPushQueue(force = false) {
  if (!force && Date.now() - lastPushScanAt < 30000) return;
  if (sendingPush) return;
  lastPushScanAt = Date.now();
  void deliverPendingPush().catch(() => console.error('Envoi push interrompu ; une nouvelle tentative sera possible.'));
}
async function deliverPendingPush() {
  if (sendingPush) return;
  sendingPush = true;
  try {
    const db = await store.read();
    if (!db.drawn) return;
    const now = Date.now();
    const jobs = [];
    for (const p of db.participants) {
      for (const subscription of p.pushSubscriptions || []) {
        if (subscription.sentAt || (subscription.attempts || 0) >= 5) continue;
        const last = Date.parse(subscription.lastAttemptAt || '') || 0;
        const delay = Math.min(10 * 60 * 1000, 30000 * (2 ** (subscription.attempts || 0)));
        if (last && now < last + delay) continue;
        jobs.push({token: p.token, subscription});
      }
    }
    let cursor = 0;
    await Promise.all(Array.from({length: Math.min(4, jobs.length)}, async () => {
      while (cursor < jobs.length) {
        const job = jobs[cursor++];
        let sent = false, gone = false;
        try {
          await webpush.sendNotification(
            {endpoint: job.subscription.endpoint, keys: job.subscription.keys},
            JSON.stringify({title: 'Le tirage a eu lieu ! 🎁', body: 'Ouvre Secret Santa pour découvrir ton résultat.'}),
            {TTL: 86400, urgency: 'high', timeout: 8000}
          );
          sent = true;
        } catch (error) {
          gone = [404, 410].includes(error.statusCode);
          console.error(gone ? 'Abonnement push expiré.' : 'Notification non acceptée ; nouvelle tentative possible.');
        }
        await store.update(current => {
          const p = current.participants.find(p => p.token === job.token);
          if (!p) return;
          const s = (p.pushSubscriptions || []).find(s => s.endpoint === job.subscription.endpoint);
          if (!s) return;
          if (gone) p.pushSubscriptions = p.pushSubscriptions.filter(s => s.endpoint !== job.subscription.endpoint);
          else if (sent) s.sentAt = new Date().toISOString();
          else { s.attempts = (s.attempts || 0) + 1; s.lastAttemptAt = new Date().toISOString(); }
        });
      }
    }));
  } finally { sendingPush = false; }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    // Sur iPhone, les Web Apps ont un stockage distinct de Safari. Leur URL de
    // lancement conserve donc la clé personnelle sans l’afficher dans l’interface.
    const personalToken = /^[a-f0-9]{48}$/.test(url.searchParams.get('t') || '') ? url.searchParams.get('t') : null;
    if (req.method === 'GET' && url.pathname === '/manifest.webmanifest') {
      const manifest = JSON.parse(await fs.readFile(new URL('./manifest.webmanifest', import.meta.url), 'utf8'));
      if (personalToken) manifest.start_url = '/?t=' + personalToken;
      res.writeHead(200, {...securityHeaders, 'Content-Type':'application/manifest+json; charset=utf-8'});
      return res.end(JSON.stringify(manifest));
    }
    if (req.method === 'GET' && staticFiles.has(url.pathname)) {
      const file = staticFiles.get(url.pathname);
      res.writeHead(200, {...securityHeaders, 'Content-Type': file.type});
      if (personalToken && (url.pathname === '/' || url.pathname === '/index.html')) {
        return res.end(file.content.toString('utf8').replace('href="/manifest.webmanifest"', 'href="/manifest.webmanifest?t=' + personalToken + '"'));
      }
      return res.end(file.content);
    }
    if (req.method === 'GET' && url.pathname === '/healthz') return send(res, 200, {ok: true});
    if (req.method === 'GET' && url.pathname === '/api/state') {
      const db = await store.read();
      if (db.drawn) kickPushQueue();
      return send(res, 200, {count: db.participants.length, drawn: db.drawn, storage: store.kind});
    }
    if (req.method === 'GET' && url.pathname === '/api/push/config') return send(res, 200, {publicKey: vapid.publicKey});
    if (req.method === 'POST' && url.pathname === '/api/join') {
      const payload = await body(req);
      const identity = names(payload);
      if (typeof payload.registrationToken !== 'string' || !/^[a-f0-9]{48}$/.test(payload.registrationToken)) {
        fail(400, 'Clé d’inscription invalide.');
      }
      const secret = payload.registrationToken;
      const result = await store.update(db => {
        const existing = db.participants.find(p => p.token === secret);
        if (existing) return {...profile(existing, db.drawn), token: existing.token};
        if (db.drawn) fail(409, 'Les inscriptions sont fermées.');
        checkName(db, identity);
        const p = {...identity, token: secret, recipient: null, pushSubscriptions: []};
        db.participants.push(p);
        return {...profile(p, false), token: p.token};
      });
      return send(res, 200, result);
    }
    if (req.method === 'POST' && url.pathname === '/api/recover') {
      throttleRecovery(req);
      const identity = names(await body(req));
      const db = await store.read();
      const p = searchRegisteredName(db, identity);
      return send(res, 200, {...profile(p, db.drawn), token: p.token});
    }
    if (req.method === 'POST' && url.pathname === '/api/profile') {
      const payload = await body(req);
      const identity = names(payload);
      const result = await store.update(db => {
        const p = findParticipant(db, payload.token);
        if (db.drawn) fail(409, 'Les modifications sont fermées après le tirage.');
        checkName(db, identity, p);
        Object.assign(p, identity);
        return profile(p, false);
      });
      return send(res, 200, result);
    }
    if (req.method === 'POST' && url.pathname === '/api/result') {
      const payload = await body(req);
      const db = await store.read();
      return send(res, 200, profile(findParticipant(db, payload.token), db.drawn));
    }
    if (req.method === 'POST' && url.pathname === '/api/push/subscribe') {
      const payload = await body(req);
      const subscription = validateSubscription(payload.subscription);
      const result = await store.update(db => {
        const p = findParticipant(db, payload.token);
        if (db.drawn) fail(409, 'Le tirage a déjà eu lieu.');
        // Le même navigateur ne doit pas recevoir plusieurs alertes pour différents participants.
        for (const other of db.participants) {
          if (other !== p) other.pushSubscriptions = (other.pushSubscriptions || []).filter(s => s.endpoint !== subscription.endpoint);
        }
        p.pushSubscriptions ||= [];
        const index = p.pushSubscriptions.findIndex(s => s.endpoint === subscription.endpoint);
        if (index !== -1) p.pushSubscriptions[index] = subscription;
        else {
          if (p.pushSubscriptions.length >= 4) p.pushSubscriptions.shift();
          p.pushSubscriptions.push(subscription);
        }
        return {ok: true};
      });
      return send(res, 200, result);
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/list') {
      requireAdmin(req);
      await body(req);
      const db = await store.read();
      return send(res, 200, adminOverview(db));
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/update') {
      requireAdmin(req);
      const payload = await body(req);
      const identity = names(payload);
      const result = await store.update(db => {
        if (db.drawn) fail(409, 'Modifications fermées après le tirage.');
        const p = findAdminParticipant(db, payload.id);
        checkName(db, identity, p);
        Object.assign(p, identity);
        return adminOverview(db);
      });
      return send(res, 200, result);
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/delete') {
      requireAdmin(req);
      const payload = await body(req);
      const result = await store.update(db => {
        if (db.drawn) fail(409, 'Suppressions fermées après le tirage.');
        const p = findAdminParticipant(db, payload.id);
        db.participants = db.participants.filter(other => other !== p);
        return adminOverview(db);
      });
      return send(res, 200, result);
    }
    if (req.method === 'POST' && url.pathname === '/api/draw') {
      requireAdmin(req);
      await body(req);
      const result = await store.update(db => {
        if (db.drawn) fail(409, 'Tirage déjà effectué.');
        if (db.participants.length < 2) fail(400, 'Il faut au moins deux participants.');
        const order = db.participants.slice();
        for (let i = order.length - 1; i > 0; i--) {
          const j = crypto.randomInt(i + 1);
          [order[i], order[j]] = [order[j], order[i]];
        }
        for (let i = 0; i < order.length; i++) order[i].recipient = displayName(order[(i + 1) % order.length]);
        db.drawn = true;
        return {ok: true, notificationDevices: db.participants.reduce((n, p) => n + (p.pushSubscriptions || []).length, 0)};
      });
      kickPushQueue(true);
      return send(res, 200, result);
    }
    return send(res, 404, {error: 'Page introuvable.'});
  } catch (error) {
    if (error instanceof ApiError) return send(res, error.status, {error: error.message});
    console.error('Requête interrompue : stockage temporairement indisponible.');
    return send(res, 503, {error: 'Connexion temporairement indisponible. Ton inscription est conservée ; réessaie dans un instant.', code: 'STORAGE_UNAVAILABLE'});
  }
});
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Secret Santa actif sur le port ${PORT}. Stockage : ${store.kind}. Notifications : Web Push.`);
  const timer = setTimeout(() => kickPushQueue(true), 3000);
  timer.unref();
});
let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  const timer = setTimeout(() => process.exit(1), 20000);
  timer.unref();
  server.close(async () => { await store.close(); clearTimeout(timer); });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
