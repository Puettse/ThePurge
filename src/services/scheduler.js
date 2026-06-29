import { renderTemplate } from './templateEngine.js';
import { purgeScheduledChannel } from './schedulerTasks.js';

export function createScheduler(context) {
  let timer = null;
  let running = false;

  async function tick() {
    if (running) return;
    running = true;

    try {
      const result = await context.db.query(
        `
        SELECT *
        FROM scheduled_jobs
        WHERE enabled = TRUE
          AND next_run_at <= NOW()
        ORDER BY next_run_at ASC
        LIMIT 10;
        `,
      );

      for (const job of result.rows) {
        await runJob(context, job);
      }
    } catch (error) {
      console.error('[scheduler] Tick failed', error);
      context.liveFeed.publish('scheduler.error', { error: String(error?.message || error) }, 'error');
    } finally {
      running = false;
    }
  }

  function start() {
    if (timer) return;
    timer = setInterval(tick, 30_000);
    tick();
    context.liveFeed.publish('scheduler.started', { intervalMs: 30_000 });
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { start, stop, tick };
}

async function runJob(context, job) {
  const payload = job.payload || {};

  try {
    if (job.job_type === 'message') {
      const channel = await context.client.channels.fetch(job.channel_id);
      const content = renderTemplate(payload.message || '', {
        guild: channel.guild,
        channel,
      }, { allowMentions: Boolean(payload.allowMentions) });
      await channel.send({ content });
    }

    if (job.job_type === 'purge') {
      await purgeScheduledChannel(context, job);
    }

    await context.db.query(
      `
      UPDATE scheduled_jobs
      SET last_run_at = NOW(),
          next_run_at = NOW() + ($2::int * INTERVAL '1 second'),
          updated_at = NOW()
      WHERE id = $1;
      `,
      [job.id, job.interval_seconds],
    );

    await context.audit.record({
      guildId: job.guild_id,
      targetId: job.channel_id,
      action: `scheduler.${job.job_type}`,
      source: 'scheduler',
      details: { jobId: job.id },
    });
  } catch (error) {
    await context.audit.record({
      guildId: job.guild_id,
      targetId: job.channel_id,
      action: 'scheduler.failed',
      source: 'scheduler',
      severity: 'error',
      details: { jobId: job.id, error: String(error?.message || error) },
    });
  }
}
