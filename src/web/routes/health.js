export function createHealthSnapshot(context, auth) {
  const runtime = context.runtime || {};
  const botReady = typeof context.client?.isReady === 'function' ? context.client.isReady() : false;
  const guildCount = context.client?.guilds?.cache?.size || 0;
  const botUser = context.client?.user?.tag || null;
  const missingRequired = context.config?.missingRequired || [];
  const database = runtime.database || {};
  const discord = runtime.discord || {};
  const jellyfinMissing = [];
  if (!context.config?.jellyfinBaseUrl) jellyfinMissing.push('JELLYFIN_BASE_URL');
  if (!context.config?.jellyfinApiKey) jellyfinMissing.push('JELLYFIN_API_KEY');

  return {
    ok: missingRequired.length === 0 && !database.error && !discord.error,
    bot: {
      ready: botReady,
      user: botUser,
      guildCount,
      error: discord.error || null,
      commandsRegistered: Boolean(discord.commandsRegistered),
    },
    database: {
      connected: Boolean(database.connected),
      error: database.error || null,
    },
    dashboard: {
      authConfigured: auth.isConfigured(),
      missingConfig: typeof auth.missingConfig === 'function' ? auth.missingConfig() : [],
    },
    integrations: {
      jellyfin: {
        configured: jellyfinMissing.length === 0,
        baseUrl: context.config?.jellyfinBaseUrl || null,
        publicBaseUrl: context.config?.jellyfinPublicBaseUrl || null,
        playLinksEnabled: Boolean(context.config?.jellyfinEnablePlayLinks),
        missingConfig: jellyfinMissing,
      },
    },
    config: {
      ready: missingRequired.length === 0,
      missingRequired,
    },
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  };
}
