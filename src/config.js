import dotenv from 'dotenv';

dotenv.config();

const required = ['BOT_TOKEN', 'DATABASE_URL', 'CLIENT_ID'];
export const DEFAULT_PUBLIC_BASE_URL = 'https://thepurge-production.up.railway.app';

export function loadConfig(env = process.env, options = {}) {
  const missing = required.filter((key) => !env[key]);
  if (missing.length > 0 && !options.allowPartial) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  return {
    botToken: env.BOT_TOKEN,
    databaseUrl: env.DATABASE_URL,
    clientId: env.CLIENT_ID,
    clientSecret: env.CLIENT_SECRET || '',
    sessionSecret: env.SESSION_SECRET || env.BOT_TOKEN || 'local-dashboard-session-secret',
    publicBaseUrl: resolvePublicBaseUrl(env, options),
    jellyfinBaseUrl: normalizeBaseUrl(env.JELLYFIN_BASE_URL || ''),
    jellyfinApiKey: env.JELLYFIN_API_KEY || '',
    port: Number.parseInt(env.PORT || '3000', 10),
    nodeEnv: env.NODE_ENV || 'development',
    missingRequired: missing,
  };
}

export function getDiscordRedirectUri(config) {
  if (!config.publicBaseUrl) return '';
  return `${config.publicBaseUrl}/auth/callback`;
}

function normalizeBaseUrl(value) {
  return String(value || '').replace(/\/+$/, '');
}

function resolvePublicBaseUrl(env, options) {
  if (env.PUBLIC_BASE_URL) {
    return normalizeBaseUrl(env.PUBLIC_BASE_URL);
  }

  if (env.RAILWAY_PUBLIC_DOMAIN) {
    return normalizeBaseUrl(`https://${env.RAILWAY_PUBLIC_DOMAIN}`);
  }

  if (options.defaultPublicBaseUrl === false) {
    return '';
  }

  return normalizeBaseUrl(options.defaultPublicBaseUrl || DEFAULT_PUBLIC_BASE_URL);
}
