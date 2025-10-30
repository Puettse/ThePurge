// file: index.js
import {
  Client,
  GatewayIntentBits,
  Partials,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  EmbedBuilder,
} from 'discord.js';
import pkg from 'pg';
import express from 'express';
import fs from 'fs';
const { Client: PgClient } = pkg;

// --- ENVIRONMENT ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;
if (!BOT_TOKEN || !DATABASE_URL) {
  console.error('❌ Missing BOT_TOKEN or DATABASE_URL. Add them in Railway → Variables.');
  process.exit(1);
}

// --- HEALTH CHECK SERVER ---
const app = express();
app.get('/', (req, res) => res.send('OK'));
app.listen(3000, () => console.log('🩺 Health check active on port 3000'));

// --- VERSION INFO ---
const versionData = JSON.parse(fs.readFileSync('./VERSION.json', 'utf-8'));
console.log(`💀 ${versionData.name} v${versionData.version} — ${versionData.codename}`);
console.log(`📅 Released: ${versionData.release_date}`);

// --- DISCORD CLIENT ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember],
});
const prefix = ',';
const purgeTasks = new Map();

// --- DATABASE ---
const db = new PgClient({ connectionString: DATABASE_URL });
await db.connect();

await db.query(`
CREATE TABLE IF NOT EXISTS purge_configs (
  id SERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  interval_ms BIGINT NOT NULL,
  media_types TEXT[],
  user_id TEXT,
  log_channel_id TEXT,
  active BOOLEAN DEFAULT TRUE
);
`);

// --- HELPERS ---
function parseInterval(value) {
  const unit = value.slice(-1);
  const num = parseInt(value);
  switch (unit) {
    case 's': return num * 1000;
    case 'm': return num * 60 * 1000;
    case 'h': return num * 60 * 60 * 1000;
    case 'd': return num * 24 * 60 * 60 * 1000;
    default: return null;
  }
}

function shouldDeleteMessage(msg, mediaTypes, targetUserId) {
  if (targetUserId && msg.author.id !== targetUserId) return false;
  if (mediaTypes.includes('all')) {
    return msg.attachments.size > 0 || msg.embeds.length > 0 || msg.stickers.size > 0;
  }
  let result = false;
  if (mediaTypes.includes('attachments') && msg.attachments.size > 0) result = true;
  if (mediaTypes.includes('stickers') && msg.stickers.size > 0) result = true;
  if (mediaTypes.includes('gifs') && msg.embeds.some(e => e.url?.includes('.gif'))) result = true;
  if (mediaTypes.includes('emojis') && /<:.+?:\d+>/.test(msg.content)) result = true;
  return result;
}

async function startPurgeTask(guildId, channelId, intervalMs, mediaTypes, userId, logChannelId) {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  const logChannel = logChannelId ? await client.channels.fetch(logChannelId).catch(() => null) : null;
  if (!channel || !channel.isTextBased()) return;

  console.log(`🩸 The Purge active in #${channel.name} every ${intervalMs / 1000}s`);

  const task = setInterval(async () => {
    try {
      const messages = await channel.messages.fetch({ limit: 100 });
      const toDelete = messages.filter(msg => shouldDeleteMessage(msg, mediaTypes, userId));
      for (const msg of toDelete.values()) await msg.delete().catch(() => {});
      if (toDelete.size > 0) {
        const summary = `🧹 The Purge deleted ${toDelete.size} message(s) in ${channel} (${mediaTypes.join(', ')})`;
        console.log(summary);
        if (logChannel) await logChannel.send(summary).catch(() => {});
      }
    } catch (err) {
      console.error('💀 Purge error:', err.message);
    }
  }, intervalMs);

  purgeTasks.set(channelId, task);
}

// --- RESTORE TASKS ON STARTUP ---
client.once('ready', async () => {
  console.log(`💀 The Purge has begun... logged in as ${client.user.tag}`);
  const res = await db.query('SELECT * FROM purge_configs WHERE active = true');
  for (const row of res.rows) {
    startPurgeTask(row.guild_id, row.channel_id, row.interval_ms, row.media_types, row.user_id, row.log_channel_id);
  }
});

// --- COMMAND HANDLER ---
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.content.startsWith(prefix)) return;
  const args = message.content.slice(prefix.length).trim().split(/\s+/);
  const command = args.shift()?.toLowerCase();

  // Stop purge
  if (command === 'p' && args[0] === 'stop') {
    const existing = await db.query(
      'UPDATE purge_configs SET active = false WHERE channel_id = $1 RETURNING *',
      [message.channel.id]
    );
    if (purgeTasks.has(message.channel.id)) {
      clearInterval(purgeTasks.get(message.channel.id));
      purgeTasks.delete(message.channel.id);
    }
    if (existing.rowCount > 0)
      return message.reply(`🛑 The Purge has ceased in ${message.channel}.`);
    else return message.reply('⚠️ No active purge found here.');
  }

  // Status command
  if (command === 'p' && args[0] === 'status') {
    const res = await db.query('SELECT * FROM purge_configs WHERE guild_id = $1 AND active = true', [message.guild.id]);
    if (res.rowCount === 0) return message.reply('💤 No active purges in this server.');
    const list = res.rows.map(r =>
      `#${message.guild.channels.cache.get(r.channel_id)?.name || 'unknown'} → every ${r.interval_ms / 1000}s → ${r.media_types.join(', ')}`
    ).join('\n');
    return message.reply(`💀 **Active Purges:**\n${list}`);
  }

  // Version command
  if (command === 'version') {
    const reply =
      `💀 **${versionData.name}**\n` +
      `🧾 Version: **${versionData.version}** — *${versionData.codename}*\n` +
      `📅 Released: ${versionData.release_date}\n` +
      `🧠 Framework: ${versionData.framework}\n` +
      `💾 Database: ${versionData.database}\n` +
      `⚙️ License: ${versionData.license}`;
    return message.reply(reply);
  }

  // Purge setup
  if (command === 'p' && !args[0]) {
    const channels = message.guild.channels.cache
      .filter(c => c.isTextBased() && c.viewable)
      .map(c => ({ label: `#${c.name}`, value: c.id }));

    const channelMenu = new StringSelectMenuBuilder()
      .setCustomId('select_channel')
      .setPlaceholder('Select a channel to purge')
      .addOptions(channels.slice(0, 25));

    const row = new ActionRowBuilder().addComponents(channelMenu);
    await message.reply({ content: '📂 Choose a channel to begin The Purge:', components: [row] });
  }
});

// --- INTERACTIONS ---
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isStringSelectMenu()) return;

  // Channel select
  if (interaction.customId === 'select_channel') {
    const channelId = interaction.values[0];
    const intervalMenu = new StringSelectMenuBuilder()
      .setCustomId(`select_interval:${channelId}`)
      .setPlaceholder('Select purge interval')
      .addOptions([
        { label: 'Every 30 seconds', value: '30s' },
        { label: 'Every 5 minutes', value: '5m' },
        { label: 'Every 1 hour', value: '1h' },
        { label: 'Every 1 day', value: '1d' },
      ]);
    const row = new ActionRowBuilder().addComponents(intervalMenu);
    await interaction.update({ content: '⏱️ Choose purge interval:', components: [row] });
  }

  // Interval select
  if (interaction.customId.startsWith('select_interval')) {
    const [_, channelId] = interaction.customId.split(':');
    const intervalValue = interaction.values[0];
    const mediaMenu = new StringSelectMenuBuilder()
      .setCustomId(`select_media:${channelId}:${intervalValue}`)
      .setPlaceholder('Select media types to purge')
      .setMinValues(1)
      .setMaxValues(5)
      .addOptions([
        { label: 'All Media', value: 'all' },
        { label: 'Attachments', value: 'attachments' },
        { label: 'GIFs', value: 'gifs' },
        { label: 'Stickers', value: 'stickers' },
        { label: 'Emojis', value: 'emojis' },
      ]);
    const row = new ActionRowBuilder().addComponents(mediaMenu);
    await interaction.update({ content: '🧩 Choose what The Purge should remove:', components: [row] });
  }

  // Media type select
  if (interaction.customId.startsWith('select_media')) {
    const [_, channelId, intervalValue] = interaction.customId.split(':');
    const mediaTypes = interaction.values;
    const channel = await interaction.guild.channels.fetch(channelId);
    const ms = parseInterval(intervalValue);

    await db.query(
      `INSERT INTO purge_configs (guild_id, channel_id, interval_ms, media_types, active)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (channel_id) DO UPDATE
       SET interval_ms = EXCLUDED.interval_ms, media_types = EXCLUDED.media_types, active = true`,
      [interaction.guild.id, channelId, ms, mediaTypes]
    );

    if (purgeTasks.has(channelId)) clearInterval(purgeTasks.get(channelId));
    startPurgeTask(interaction.guild.id, channelId, ms, mediaTypes);

    await interaction.update({ content: `💀 The Purge is active in ${channel} every ${intervalValue}.`, components: [] });
  }
});

client.login(BOT_TOKEN);
