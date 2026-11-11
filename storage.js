import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export const emptyState = () => ({participants: [], drawn: false});
export const displayName = p => [p.firstName, p.lastName].filter(Boolean).join(' ').trim() || String(p.name || '').trim();

/** Reject damaged data instead of silently replacing it with an empty draw. */
export function validateState(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.participants) || typeof value.drawn !== 'boolean') {
    throw new Error('Format de sauvegarde invalide. Aucune donn\u00e9e n\u2019a \u00e9t\u00e9 remplac\u00e9e.');
  }
  const db = structuredClone(value);
  const tokens = new Set();
  const names = new Set();
  for (const p of db.participants) {
    if (!p || typeof p.token !== 'string' || !p.token || tokens.has(p.token)) {
      throw new Error('Sauvegarde invalide : lien personnel absent ou dupliqu\u00e9.');
    }
    if ((p.firstName !== undefined && typeof p.firstName !== 'string') ||
        (p.lastName !== undefined && typeof p.lastName !== 'string') ||
        (p.name !== undefined && typeof p.name !== 'string')) {
      throw new Error('Sauvegarde invalide : identit\u00e9 incorrecte.');
    }
    p.firstName = (p.firstName || '').trim();
    p.lastName = (p.lastName || '').trim();
    p.name = displayName(p);
    if (!p.name || names.has(p.name.toLocaleLowerCase('fr'))) {
      throw new Error('Sauvegarde invalide : nom absent ou dupliqu\u00e9.');
    }
    p.recipient ??= null;
    tokens.add(p.token);
    names.add(p.name.toLocaleLowerCase('fr'));
  }
  if (db.drawn) {
    const recipients = new Set();
    for (const p of db.participants) {
      if (typeof p.recipient !== 'string' || !names.has(p.recipient.toLocaleLowerCase('fr')) ||
          p.recipient === p.name || recipients.has(p.recipient)) {
        throw new Error('Sauvegarde invalide : tirage incoh\u00e9rent.');
      }
      recipients.add(p.recipient);
    }
    if (db.participants.length < 2) throw new Error('Sauvegarde invalide : tirage incomplet.');
  }
  return db;
}

/** All mutations run against a locked current database row and commit before replying. */
export async function createPostgresStore(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS secret_santa_state (
    id SMALLINT PRIMARY KEY CHECK (id = 1),
    document JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  // ON CONFLICT deliberately does NOT update: a restart must never reset the draw.
  await pool.query(
    'INSERT INTO secret_santa_state (id, document) VALUES (1, $1::jsonb) ON CONFLICT (id) DO NOTHING',
    [JSON.stringify(emptyState())]
  );
  const decode = result => {
    if (result.rows.length !== 1) throw new Error('Sauvegarde absente. Restauration n\u00e9cessaire.');
    return validateState(result.rows[0].document);
  };
  const store = {
    kind: 'postgres',
    read: async () => decode(await pool.query('SELECT document FROM secret_santa_state WHERE id = 1')),
    async update(change) {
      const client = await pool.connect();
      let destroy = false;
      try {
        await client.query('BEGIN');
        await client.query("SET LOCAL lock_timeout = '10s'");
        const current = decode(await client.query('SELECT document FROM secret_santa_state WHERE id = 1 FOR UPDATE'));
        const result = await change(current);
        validateState(current);
        await client.query('UPDATE secret_santa_state SET document = $1::jsonb, updated_at = NOW() WHERE id = 1', [JSON.stringify(current)]);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch { destroy = true; }
        throw error;
      } finally { client.release(destroy); }
    },
    close: () => pool.end()
  };
  await store.read();
  return store;
}

/** Local development only, or a deliberately configured persistent disk. One process. */
export async function createFileStore(filename) {
  const file = path.resolve(filename);
  let db;
  try { db = validateState(JSON.parse(await fs.readFile(file, 'utf8'))); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    db = emptyState();
  }
  let queue = Promise.resolve();
  return {
    kind: 'file',
    read: async () => { await queue; return structuredClone(db); },
    update(change) {
      const task = queue.then(async () => {
        const next = structuredClone(db);
        const result = await change(next);
        validateState(next);
        await fs.mkdir(path.dirname(file), {recursive: true});
        const tmp = `${file}.${crypto.randomBytes(8).toString('hex')}.tmp`;
        try {
          const handle = await fs.open(tmp, 'wx', 0o600);
          try { await handle.writeFile(JSON.stringify(next, null, 2)); await handle.sync(); }
          finally { await handle.close(); }
          await fs.rename(tmp, file);
        } finally { await fs.rm(tmp, {force: true}).catch(() => {}); }
        db = next;
        return result;
      });
      queue = task.catch(() => {});
      return task;
    },
    close: async () => { await queue; }
  };
}

export async function createStorage(env = process.env) {
  if (env.DATABASE_URL) {
    const {default: pg} = await import('pg');
    const pool = new pg.Pool({
      connectionString: env.DATABASE_URL,
      enableChannelBinding: true,
      max: 5,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 15000,
      statement_timeout: 15000,
      application_name: 'secret-santa'
    });
    // Do not log credentials or raw database errors, which can contain private data.
    pool.on('error', () => console.error('Connexion PostgreSQL interrompue ; reconnexion au prochain acc\u00e8s.'));
    try { return await createPostgresStore(pool); }
    catch (error) { await pool.end().catch(() => {}); throw error; }
  }
  if (env.RENDER && !(env.PERSISTENT_FILE_STORAGE === 'true' && env.DATA_FILE)) {
    throw new Error('DATABASE_URL manquante : ajoutez une base PostgreSQL dans Environment. D\u00e9marrage refus\u00e9 pour ne pas perdre les inscriptions.');
  }
  return createFileStore(env.DATA_FILE || 'data.json');
}
