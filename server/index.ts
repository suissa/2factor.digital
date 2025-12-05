import express from 'express';
import cors from 'cors';
import Database from 'better-sqlite3';
import { randomUUID, randomInt } from 'crypto';

const app = express();
const db = new Database('server/data.sqlite');

app.use(cors());
app.use(express.json());

initializeDatabase();

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
      expires_in INTEGER NOT NULL
    )`
  ).run();
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
