import crypto from 'node:crypto';
import { getDiscordRedirectUri } from '../config.js';

const sessions = new Map();

export function createAuth(config) {
  const cookieName = 'thepurge_session';

  function isConfigured() {
    return Boolean(config.clientId && config.clientSecret && config.publicBaseUrl);
  }

  function sign(value) {
    return crypto
      .createHmac('sha256', config.sessionSecret)
      .update(value)
      .digest('base64url');
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
    if (!isConfigured()) {
      res.status(503).send('Discord OAuth is not configured. Set CLIENT_SECRET and PUBLIC_BASE_URL.');
      return;
    }

    const state = crypto.randomBytes(24).toString('hex');
    res.cookie('thepurge_oauth_state', `${state}.${sign(state)}`, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.nodeEnv === 'production',
      maxAge: 1000 * 60 * 10,
    });

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
    const rawState = req.cookies?.thepurge_oauth_state;
    const expected = rawState?.split('.')[0];
    const signature = rawState?.split('.')[1];

    if (!code || !state || state !== expected || signature !== sign(expected)) {
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
    if (!isConfigured()) {
      res.status(503).json({ error: 'Dashboard OAuth is not configured.', authConfigured: false });
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

  return { isConfigured, login, callback, logout, requireAuth, readCookie };
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
