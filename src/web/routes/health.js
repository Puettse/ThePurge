export function createHealthSnapshot(context, auth) {
  return {
    ok: true,
    bot: {
      ready: context.client.isReady(),
      user: context.client.user?.tag || null,
      guildCount: context.client.guilds.cache.size,
    },
    database: { connected: true },
    dashboard: { authConfigured: auth.isConfigured() },
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  };
}
