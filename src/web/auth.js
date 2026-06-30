import crypto from 'node:crypto';
import { getDiscordRedirectUri } from '../config.js';

const sessions = new Map();
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export function createAuth(config) {
  const cookieName = 'thepurge_session';

  function missingConfig() {
    return [
      ['CLIENT_ID', config.clientId],
      ['CLIENT_SECRET', config.clientSecret],
      ['PUBLIC_BASE_URL', config.publicBaseUrl],
    ]
      .filter(([, value]) => !value)
      .map(([key]) => key);
  }

  function isConfigured() {
    return missingConfig().length === 0;
  }

  function sign(value) {
    return signValue(config.sessionSecret, value);
  }

  function setCookie(res, sessionId) {
    const signed = `${sessionId}.${sign(sessionId)}`;
    res.cookie(cookieName, signed, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.nodeEnv === 'production',
      maxAge: 1000 * 60 * 60 * 8,
    });
  }

  function readCookie(req) {
    const raw = req.cookies?.[cookieName];
    if (!raw || !raw.includes('.')) return null;
    const [sessionId, signature] = raw.split('.');
    if (signature !== sign(sessionId)) return null;
    return sessions.get(sessionId) || null;
  }

  function clearCookie(res) {
    res.clearCookie(cookieName);
  }

  function createSession(payload) {
    const sessionId = crypto.randomUUID();
    sessions.set(sessionId, {
      ...payload,
      createdAt: Date.now(),
    });
    return sessionId;
  }

  async function login(req, res) {
    const missing = missingConfig();
    if (missing.length > 0) {
      res.status(503).send(`Discord OAuth is not configured. Set ${missing.join(', ')}.`);
      return;
    }

    const state = createOAuthState(config.sessionSecret);

    const url = new URL('https://discord.com/api/oauth2/authorize');
    url.searchParams.set('client_id', config.clientId);
    url.searchParams.set('redirect_uri', getDiscordRedirectUri(config));
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'identify guilds');
    url.searchParams.set('state', state);
    res.redirect(url.toString());
  }

  async function callback(req, res) {
    const { code, state } = req.query;

    if (!code || !verifyOAuthState(config.sessionSecret, String(state || ''))) {
      res.status(400).send('Invalid OAuth state.');
      return;
    }

    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: 'authorization_code',
        code: String(code),
        redirect_uri: getDiscordRedirectUri(config),
      }),
    });

    if (!tokenResponse.ok) {
      res.status(502).send('Discord OAuth token exchange failed.');
      return;
    }

    const token = await tokenResponse.json();
    const [user, guilds] = await Promise.all([
      fetchDiscord('/users/@me', token.access_token),
      fetchDiscord('/users/@me/guilds', token.access_token),
    ]);

    const sessionId = createSession({
      user,
      guilds,
      accessToken: token.access_token,
      expiresAt: Date.now() + Number(token.expires_in || 0) * 1000,
    });

    setCookie(res, sessionId);
    res.clearCookie('thepurge_oauth_state');
    res.redirect('/');
  }

  async function logout(req, res) {
    const raw = req.cookies?.[cookieName];
    const sessionId = raw?.split('.')[0];
    if (sessionId) sessions.delete(sessionId);
    clearCookie(res);
    res.json({ ok: true });
  }

  function requireAuth(req, res, next) {
    const missing = missingConfig();
    if (missing.length > 0) {
      res.status(503).json({ error: 'Dashboard OAuth is not configured.', authConfigured: false, missingConfig: missing });
      return;
    }

    const session = readCookie(req);
    if (!session || session.expiresAt < Date.now()) {
      res.status(401).json({ error: 'Authentication required.', authConfigured: true });
      return;
    }

    req.session = session;
    next();
  }

  return { isConfigured, missingConfig, login, callback, logout, requireAuth, readCookie };
}

export function createOAuthState(sessionSecret, now = Date.now()) {
  const payload = Buffer
    .from(JSON.stringify({
      nonce: crypto.randomBytes(24).toString('hex'),
      issuedAt: now,
    }), 'utf8')
    .toString('base64url');

  return `${payload}.${signValue(sessionSecret, payload)}`;
}

export function verifyOAuthState(sessionSecret, state, now = Date.now()) {
  if (typeof state !== 'string' || !state.includes('.')) return false;
  const [payload, signature] = state.split('.');
  if (!payload || !signature || !timingSafeEqual(signature, signValue(sessionSecret, payload))) {
    return false;
  }

  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const issuedAt = Number(decoded.issuedAt || 0);
    if (!Number.isFinite(issuedAt) || issuedAt <= 0) return false;
    if (issuedAt > now + 60_000) return false;
    return now - issuedAt <= OAUTH_STATE_TTL_MS;
  } catch {
    return false;
  }
}

function signValue(secret, value) {
  return crypto
    .createHmac('sha256', secret)
    .update(value)
    .digest('base64url');
}

function timingSafeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function canManageGuild(guild) {
  const permissions = BigInt(guild.permissions || 0);
  const administrator = 0x8n;
  const manageGuild = 0x20n;
  return Boolean(guild.owner || (permissions & administrator) === administrator || (permissions & manageGuild) === manageGuild);
}

export async function fetchDiscord(path, accessToken) {
  const response = await fetch(`https://discord.com/api/v10${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Discord API request failed: ${response.status}`);
  }

  return response.json();
}
