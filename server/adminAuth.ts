import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Collection } from 'mongodb';

const SESSION_SECONDS = 8 * 60 * 60;
const LOGIN_WINDOW_MS = 15 * 60 * 1_000;
const MAX_LOGIN_ATTEMPTS = 5;

export interface AdminLoginLimitDocument {
  key: string;
  attempts: number;
  expiresAt: Date;
}

export interface AdminAuthConfig {
  username: string;
  passwordScrypt: string;
  sessionSecret: string;
  secureCookies: boolean;
}

export class AdminAuthError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'AdminAuthError';
  }
}

export function createAdminAuth(config: AdminAuthConfig, limits: Collection<AdminLoginLimitDocument>) {
  if (config.sessionSecret.length < 32) throw new Error('ADMIN_SESSION_SECRET must contain at least 32 characters');
  parsePasswordHash(config.passwordScrypt);

  return {
    async login(username: unknown, password: unknown, remoteAddress: string) {
      if (typeof username !== 'string' || typeof password !== 'string') throw new AdminAuthError('Invalid credentials.', 401);
      const key = createHmac('sha256', config.sessionSecret).update(remoteAddress).digest('hex');
      const current = await limits.findOne({ key });
      if (current && current.expiresAt > new Date() && current.attempts >= MAX_LOGIN_ATTEMPTS) {
        throw new AdminAuthError('Too many login attempts. Try again later.', 429);
      }
      const validUser = safeTextEqual(username, config.username);
      const validPassword = verifyPassword(password, config.passwordScrypt);
      if (!validUser || !validPassword) {
        const expiresAt = new Date(Date.now() + LOGIN_WINDOW_MS);
        await limits.updateOne(
          { key },
          { $inc: { attempts: 1 }, $set: { expiresAt } },
          { upsert: true },
        );
        throw new AdminAuthError('Invalid credentials.', 401);
      }
      await limits.deleteOne({ key });
      const csrf = randomBytes(24).toString('base64url');
      const expiresAt = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
      return { token: signSession(expiresAt, csrf, config.sessionSecret), csrf, expiresAt };
    },
    require(request: IncomingMessage, mutate = false) {
      const token = parseCookies(request.headers.cookie || '').taxi_admin_session;
      if (!token) throw new AdminAuthError('Authentication required.', 401);
      const session = verifySession(token, config.sessionSecret);
      if (mutate) {
        const csrf = request.headers['x-csrf-token'];
        if (typeof csrf !== 'string' || !safeTextEqual(csrf, session.csrf)) throw new AdminAuthError('Invalid CSRF token.', 403);
      }
      return session;
    },
    setSessionCookie(response: ServerResponse, token: string) {
      response.setHeader('set-cookie', cookie(token, SESSION_SECONDS, config.secureCookies));
    },
    clearSessionCookie(response: ServerResponse) {
      response.setHeader('set-cookie', cookie('', 0, config.secureCookies));
    },
  };
}

export function makePasswordHash(password: string, salt = randomBytes(16)) {
  if (password.length < 12) throw new Error('Admin password must contain at least 12 characters');
  return `scrypt$${salt.toString('hex')}$${scryptSync(password, salt, 32).toString('hex')}`;
}

export function verifyPassword(password: string, encoded: string) {
  const { salt, digest } = parsePasswordHash(encoded);
  const actual = scryptSync(password, salt, digest.length);
  return actual.length === digest.length && timingSafeEqual(actual, digest);
}

function parsePasswordHash(encoded: string) {
  const [scheme, saltHex, digestHex, ...rest] = encoded.split('$');
  if (scheme !== 'scrypt' || rest.length || !/^[a-f0-9]{32}$/i.test(saltHex || '') || !/^[a-f0-9]{64}$/i.test(digestHex || '')) {
    throw new Error('ADMIN_PASSWORD_SCRYPT must use scrypt$saltHex$digestHex format');
  }
  return { salt: Buffer.from(saltHex, 'hex'), digest: Buffer.from(digestHex, 'hex') };
}

function signSession(expiresAt: number, csrf: string, secret: string) {
  const payload = `${expiresAt}.${csrf}`;
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function verifySession(token: string, secret: string) {
  const [expiresRaw, csrf, signature, ...rest] = token.split('.');
  const expiresAt = Number(expiresRaw);
  if (rest.length || !Number.isSafeInteger(expiresAt) || !csrf || !signature) throw new AdminAuthError('Invalid session.', 401);
  const expected = createHmac('sha256', secret).update(`${expiresRaw}.${csrf}`).digest('base64url');
  if (!safeTextEqual(signature, expected) || expiresAt <= Math.floor(Date.now() / 1000)) throw new AdminAuthError('Session expired.', 401);
  return { csrf, expiresAt };
}

function parseCookies(raw: string) {
  return Object.fromEntries(raw.split(';').flatMap(part => {
    const separator = part.indexOf('=');
    if (separator < 0) return [];
    return [[part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1).trim())]];
  }));
}

function cookie(value: string, maxAge: number, secure: boolean) {
  return `taxi_admin_session=${encodeURIComponent(value)}; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

function safeTextEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
