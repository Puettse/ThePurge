import { isModuleEnabled } from '../db/index.js';

const discordInvitePattern = /(discord\.gg\/|discord\.com\/invite\/)/i;
const urlPattern = /https?:\/\/\S+/i;

export async function runAutomod(context, message) {
  if (!message.guild || message.author.bot) return;
  if (!(await isModuleEnabled(context.db, message.guild.id, 'automod'))) return;

  const result = await context.db.query(
    'SELECT * FROM automation_rules WHERE guild_id = $1 AND rule_type = $2 AND enabled = TRUE',
    [message.guild.id, 'automod'],
  );

  for (const rule of result.rows) {
    const trigger = rule.trigger || {};
    if (matchesRule(message, trigger)) {
      await applyAutomodActions(context, message, rule.actions || [], rule.id);
      break;
    }
  }
}

function matchesRule(message, trigger) {
  const content = message.content || '';

  if (trigger.blockInvites && discordInvitePattern.test(content)) return true;
  if (trigger.blockLinks && urlPattern.test(content)) return true;
  if (Array.isArray(trigger.blockedWords) && trigger.blockedWords.some((word) => content.toLowerCase().includes(String(word).toLowerCase()))) {
    return true;
  }
  if (trigger.blockAttachments && message.attachments.size > 0) return true;
  if (Number.isInteger(trigger.maxMentions) && message.mentions.users.size > trigger.maxMentions) return true;

  return false;
}

async function applyAutomodActions(context, message, actions, ruleId) {
  for (const action of actions) {
    if (action.type === 'delete') {
      await message.delete().catch(() => null);
    }

    if (action.type === 'reply' && action.message) {
      await message.channel.send({ content: action.message }).catch(() => null);
    }

    if (action.type === 'timeout') {
      await message.member?.timeout?.(Number(action.durationSeconds || 60) * 1000, 'AutoMod rule').catch(() => null);
    }
  }

  await context.audit.record({
    guildId: message.guild.id,
    actorId: message.author.id,
    targetId: message.channel.id,
    action: 'automod.triggered',
    source: 'discord',
    details: { ruleId, messageId: message.id },
  });
}
