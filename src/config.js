import dotenv from 'dotenv';

dotenv.config();

const required = ['BOT_TOKEN', 'DATABASE_URL', 'CLIENT_ID'];

export function loadConfig(env = process.env) {
  const missing = required.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  return {
    botToken: env.BOT_TOKEN,
    databaseUrl: env.DATABASE_URL,
    clientId: env.CLIENT_ID,
    clientSecret: env.CLIENT_SECRET || '',
    sessionSecret: env.SESSION_SECRET || env.BOT_TOKEN,
    publicBaseUrl: env.PUBLIC_BASE_URL || env.RAILWAY_PUBLIC_DOMAIN
      ? normalizeBaseUrl(env.PUBLIC_BASE_URL || `https://${env.RAILWAY_PUBLIC_DOMAIN}`)
      : '',
    port: Number.parseInt(env.PORT || '3000', 10),
    nodeEnv: env.NODE_ENV || 'development',
  };
}

export function getDiscordRedirectUri(config) {
  if (!config.publicBaseUrl) return '';
  return `${config.publicBaseUrl}/auth/callback`;
}

function normalizeBaseUrl(value) {
  return String(value || '').replace(/\/+$/, '');
}
