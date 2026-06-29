import { canModerateTarget } from '../services/permissionService.js';

export async function runDashboardModerationAction(context, guild, dashboardUser, body) {
  const action = body.action;
  const targetId = body.targetId;
  const reason = body.reason || `Dashboard action by ${dashboardUser.username}`;

  if (!['warn', 'timeout', 'kick', 'ban'].includes(action)) {
    return { ok: false, message: 'Unsupported dashboard moderation action.' };
  }

  if (!targetId) {
    return { ok: false, message: 'targetId is required.' };
  }

  const targetMember = await guild.members.fetch(targetId).catch(() => null);
  if (!targetMember && action !== 'ban') {
    return { ok: false, message: 'Target member was not found.' };
  }

  const actorMember = await guild.members.fetch(dashboardUser.id).catch(() => null);
  const botMember = await guild.members.fetchMe();
  if (action !== 'ban') {
    const check = canModerateTarget(actorMember, targetMember, botMember, action);
    if (!check.ok) return { ok: false, message: check.reason };
  }

  if (action === 'timeout') {
    await targetMember.timeout(Number(body.durationSeconds || 60) * 1000, reason);
  }

  if (action === 'kick') {
    await targetMember.kick(reason);
  }

  if (action === 'ban') {
    await guild.members.ban(targetId, { reason });
  }

  const result = await context.db.query(
    `
    INSERT INTO moderation_cases (guild_id, case_type, actor_id, target_id, reason, duration_seconds, status)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id;
    `,
    [
      guild.id,
      action,
      dashboardUser.id,
      targetId,
      reason,
      action === 'timeout' ? Number(body.durationSeconds || 60) : null,
      action === 'warn' ? 'open' : 'closed',
    ],
  );

  await context.audit.record({
    guildId: guild.id,
    actorId: dashboardUser.id,
    targetId,
    action: `moderation.${action}`,
    source: 'dashboard',
    details: { caseId: result.rows[0].id, reason },
  });

  return { ok: true, message: `Recorded ${action} as case #${result.rows[0].id}.` };
}
