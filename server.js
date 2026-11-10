import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const PORT = process.env.PORT || 3000;
const ADMIN_CODE = process.env.ADMIN_CODE;
if(!ADMIN_CODE){
  console.error('Configurez ADMIN_CODE avant de démarrer.');
  process.exit(1);
}

const file = path.resolve('data.json');
let db = {participants:[], drawn:false};
try { db = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}

const displayName = (participant = {}) => {
  if(participant.firstName || participant.lastName){
    return [participant.firstName, participant.lastName].filter(Boolean).join(' ').trim();
  }
  return String(participant.name || '').trim();
};

const normalizeParticipant = (participant = {}) => ({
  ...participant,
  firstName: String(participant.firstName || '').trim(),
  lastName: String(participant.lastName || '').trim(),
  name: displayName(participant),
  recipient: participant.recipient ?? null,
  token: participant.token
});

db.participants = Array.isArray(db.participants) ? db.participants.map(normalizeParticipant) : [];
db.drawn = Boolean(db.drawn);

const save = () => {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, file);
};

const send = (res, status, obj) => {
  res.writeHead(status, {
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store'
  });
  res.end(JSON.stringify(obj));
};

const body = async req => {
  let s = '';
  for await(const chunk of req){
    s += chunk;
    if(s.length > 10000) throw Error('Requête trop longue');
  }
  return JSON.parse(s || '{}');
};

const admin = req => {
  const a = Buffer.from(String(req.headers['x-admin-code'] || ''));
  const b = Buffer.from(ADMIN_CODE);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const makeToken = () => crypto.randomBytes(24).toString('hex');
const shuffle = a => {
  for(let i = a.length - 1; i > 0; i--){
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');

    if(req.method === 'GET' && url.pathname === '/api/state'){
      return send(res, 200, {
        participants: db.participants.map(displayName),
        drawn: db.drawn
      });
    }

    if(req.method === 'POST' && url.pathname === '/api/join'){
      if(db.drawn) return send(res, 409, {error:'Les inscriptions sont fermées.'});

      const payload = await body(req);
      const legacyName = String(payload.name || '').trim();
      const firstName = String(payload.firstName || '').trim().replace(/\s+/g, ' ');
      const lastName = String(payload.lastName || '').trim().replace(/\s+/g, ' ');

      let cleanFirstName = firstName;
      let cleanLastName = lastName;

      if(!cleanFirstName && legacyName){
        const parts = legacyName.split(/\s+/);
        cleanFirstName = parts.shift() || '';
        cleanLastName = parts.join(' ');
      }

      if(cleanFirstName.length < 2 || cleanFirstName.length > 40){
        return send(res, 400, {error:'Prénom entre 2 et 40 caractères.'});
      }
      if(cleanLastName.length < 1 || cleanLastName.length > 40){
        return send(res, 400, {error:'Nom entre 1 et 40 caractères.'});
      }

      const fullName = `${cleanFirstName} ${cleanLastName}`.trim();
      const lower = fullName.toLocaleLowerCase('fr');
      if(db.participants.some(p => displayName(p).toLocaleLowerCase('fr') === lower)){
        return send(res, 409, {error:'Cette personne est déjà inscrite.'});
      }

      const participant = normalizeParticipant({
        firstName: cleanFirstName,
        lastName: cleanLastName,
        token: makeToken(),
        recipient: null
      });
      db.participants.push(participant);
      save();
      return send(res, 200, {name:displayName(participant), token:participant.token});
    }

    if(req.method === 'POST' && url.pathname === '/api/draw'){
      if(!admin(req)) return send(res, 403, {error:'Code organisateur incorrect.'});
      if(db.drawn) return send(res, 409, {error:'Tirage déjà effectué.'});
      if(db.participants.length < 2) return send(res, 400, {error:'Il faut au moins deux participants.'});

      const n = db.participants.length;
      const order = shuffle([...Array(n).keys()]);
      for(let i = 0; i < n; i++){
        db.participants[order[i]].recipient = displayName(db.participants[order[(i + 1) % n]]);
      }
      db.drawn = true;
      save();
      return send(res, 200, {ok:true});
    }

    if(req.method === 'POST' && url.pathname === '/api/result'){
      const {token:provided} = await body(req);
      const participant = db.participants.find(p => p.token === provided);
      if(!participant) return send(res, 403, {error:'Lien personnel invalide.'});
      return send(res, 200, {
        name: displayName(participant),
        drawn: db.drawn,
        recipient: db.drawn ? participant.recipient : null
      });
    }

    if(req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')){
      res.writeHead(200, {'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store'});
      return fs.createReadStream(path.resolve('index.html')).pipe(res);
    }

    return send(res, 404, {error:'Page introuvable'});
  } catch {
    return send(res, 400, {error:'Requête invalide.'});
  }
});

server.listen(PORT, () => console.log(`Secret Santa sur http://localhost:${PORT}`));
