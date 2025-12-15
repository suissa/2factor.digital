import express from 'express';
import cors from 'cors';
import Database from 'better-sqlite3';
import { randomUUID, randomInt } from 'crypto';

const app = express();
const db = new Database('server/data.sqlite');

app.use(cors());
app.use(express.json());

initializeDatabase();

type ApplicationRow = {
  id: number;
  name: string;
  redirect_uri: string;
  created_at: number;
};

type MTPServerRow = {
  id: number;
  name: string;
  url: string;
  description: string;
  created_at: number;
};

type TokenRow = {
  phone: string;
  credential_id: string;
  access_token: string;
  refresh_token: string;
  issued_at: number;
  expires_in: number;
  revoked: number;
  revoked_at: number | null;
};

app.post('/api/send-code', (req, res) => {
  const phone = String(req.body?.phone || '').trim();
  if (!phone) {
    res.status(400).send('Número é obrigatório');
    return;
  }

  const otp = generateOtp();
  const flowToken = randomUUID();
  const expiresAt = Date.now() + 60_000;

  db.prepare('DELETE FROM otp_codes WHERE phone = ?').run(phone);
  db.prepare('INSERT INTO otp_codes (phone, code, expires_at, flow_token, used) VALUES (?, ?, ?, ?, 0)').run(phone, otp, expiresAt, flowToken);

  res.json({ codePreview: otp, flowToken, expiresAt });
});

app.post('/api/verify-code', (req, res) => {
  const { phone, otp, flowToken } = req.body ?? {};
  const record = db
    .prepare('SELECT * FROM otp_codes WHERE phone = ? AND flow_token = ? AND code = ? AND used = 0')
    .get(phone, otp, flowToken) as OTPRow | undefined;

  if (!record) {
    res.status(400).send('Código inválido ou já utilizado.');
    return;
  }

  if (Date.now() > record.expires_at) {
    res.status(400).send('Código expirado.');
    return;
  }

  db.prepare('UPDATE otp_codes SET used = 1 WHERE phone = ? AND flow_token = ?').run(phone, flowToken);
  res.json({ success: true });
});

app.post('/api/register-passkey', (req, res) => {
  const { phone, credentialId } = req.body ?? {};
  if (!phone || !credentialId) {
    res.status(400).send('Telefone e credentialId são obrigatórios.');
    return;
  }

  const validatedOtp = db
    .prepare('SELECT * FROM otp_codes WHERE phone = ? AND used = 1 ORDER BY expires_at DESC LIMIT 1')
    .get(phone) as OTPRow | undefined;

  if (!validatedOtp || Date.now() - validatedOtp.expires_at > 5 * 60_000) {
    res.status(400).send('Valide o código antes de registrar uma passkey.');
    return;
  }

  db.prepare('INSERT OR REPLACE INTO passkeys (phone, credential_id, created_at) VALUES (?, ?, ?)').run(phone, credentialId, Date.now());
  res.json({ success: true });
});

app.post('/oauth/token-ingestion', (req, res) => {
  const { phone, credentialId } = req.body ?? {};
  const passkey = db
    .prepare('SELECT * FROM passkeys WHERE phone = ? AND credential_id = ?')
    .get(phone, credentialId) as PasskeyRow | undefined;

  if (!passkey) {
    res.status(400).send('Passkey não encontrada para este número.');
    return;
  }

  const accessToken = `atk_${randomUUID()}`;
  const refreshToken = `rtk_${randomUUID()}`;
  const issuedAt = Date.now();
  const expiresIn = 15 * 60; // 15 minutes

  db.prepare('INSERT INTO oauth_tokens (phone, credential_id, access_token, refresh_token, issued_at, expires_in) VALUES (?, ?, ?, ?, ?, ?)')
    .run(phone, credentialId, accessToken, refreshToken, issuedAt, expiresIn);

  res.json({ access_token: accessToken, refresh_token: refreshToken, issued_at: new Date(issuedAt).toISOString(), expires_in: expiresIn });
});

app.get('/api/apps', (_req, res) => {
  const apps = db.prepare('SELECT * FROM applications ORDER BY created_at DESC').all() as ApplicationRow[];
  res.json(apps);
});

app.post('/api/apps', (req, res) => {
  const { name, redirectUri } = req.body ?? {};
  if (!name || !redirectUri) {
    res.status(400).send('Nome e Redirect URI são obrigatórios.');
    return;
  }

  db.prepare('INSERT INTO applications (name, redirect_uri, created_at) VALUES (?, ?, ?)').run(name, redirectUri, Date.now());
  res.json({ success: true });
});

app.get('/api/mtp-servers', (_req, res) => {
  const servers = db.prepare('SELECT * FROM mtp_servers ORDER BY created_at DESC').all() as MTPServerRow[];
  res.json(servers);
});

app.post('/api/mtp-servers', (req, res) => {
  const { name, url, description } = req.body ?? {};
  if (!name || !url) {
    res.status(400).send('Nome e URL são obrigatórios.');
    return;
  }

  db.prepare('INSERT INTO mtp_servers (name, url, description, created_at) VALUES (?, ?, ?, ?)').run(name, url, description || '', Date.now());
  res.json({ success: true });
});

app.get('/api/tokens', (req, res) => {
  const phone = String(req.query.phone || '').trim();
  if (!phone) {
    res.status(400).send('Informe o telefone para listar tokens.');
    return;
  }

  const tokens = db
    .prepare('SELECT * FROM oauth_tokens WHERE phone = ? ORDER BY issued_at DESC')
    .all(phone) as TokenRow[];

  res.json(tokens);
});

app.post('/api/tokens/revoke', (req, res) => {
  const { accessToken } = req.body ?? {};
  if (!accessToken) {
    res.status(400).send('Informe o access token para revogar.');
    return;
  }

  const result = db.prepare('UPDATE oauth_tokens SET revoked = 1, revoked_at = ? WHERE access_token = ? AND revoked = 0').run(Date.now(), accessToken);
  if (result.changes === 0) {
    res.status(404).send('Token não encontrado ou já revogado.');
    return;
  }

  res.json({ success: true });
});

const PORT = 4173;
app.listen(PORT, () => {
  console.log(`API server listening on port ${PORT}`);
});

function generateOtp() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

function initializeDatabase() {
  db.prepare(
    `CREATE TABLE IF NOT EXISTS otp_codes (
      phone TEXT NOT NULL,
      code TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      flow_token TEXT NOT NULL,
      used INTEGER DEFAULT 0
    )`
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS passkeys (
      phone TEXT NOT NULL,
      credential_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (phone)
    )`
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS oauth_tokens (
      phone TEXT NOT NULL,
      credential_id TEXT NOT NULL,
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      issued_at INTEGER NOT NULL,
      expires_in INTEGER NOT NULL,
      revoked INTEGER DEFAULT 0,
      revoked_at INTEGER
    )`
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS mtp_servers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      description TEXT,
      created_at INTEGER NOT NULL
    )`
  ).run();

  const tokenColumns = db.prepare('PRAGMA table_info(oauth_tokens)').all() as { name: string }[];
  const hasRevoked = tokenColumns.some((col) => col.name === 'revoked');
  const hasRevokedAt = tokenColumns.some((col) => col.name === 'revoked_at');
  if (!hasRevoked) {
    db.prepare('ALTER TABLE oauth_tokens ADD COLUMN revoked INTEGER DEFAULT 0').run();
  }
  if (!hasRevokedAt) {
    db.prepare('ALTER TABLE oauth_tokens ADD COLUMN revoked_at INTEGER').run();
  }
}

interface OTPRow {
  phone: string;
  code: string;
  expires_at: number;
  flow_token: string;
  used: number;
}

interface PasskeyRow {
  phone: string;
  credential_id: string;
  created_at: number;
}
