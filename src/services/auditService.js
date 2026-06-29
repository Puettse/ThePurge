export function createAuditService({ db, liveFeed }) {
  async function record(event) {
    const normalized = {
      guildId: event.guildId || null,
      actorId: event.actorId || null,
      targetId: event.targetId || null,
      action: event.action,
      source: event.source || 'system',
      severity: event.severity || 'info',
      details: event.details || {},
    };

    liveFeed.publish(`audit.${normalized.action}`, normalized, normalized.severity);

    try {
      await db.query(
        `
        INSERT INTO audit_events (guild_id, actor_id, target_id, action, source, severity, details)
        VALUES ($1, $2, $3, $4, $5, $6, $7);
        `,
        [
          normalized.guildId,
          normalized.actorId,
          normalized.targetId,
          normalized.action,
          normalized.source,
          normalized.severity,
          JSON.stringify(normalized.details),
        ],
      );
    } catch (error) {
      console.error('[audit] Failed to persist audit event', error);
      liveFeed.publish('audit.persist_failed', { error: String(error?.message || error) }, 'error');
    }
  }

  return { record };
}
