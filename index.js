// === File: index.js ===
import {
  Client,
  GatewayIntentBits,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  REST,
} from 'discord.js';
import pkg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Client: PGClient } = pkg;

// === ENVIRONMENT CHECK ===
if (!process.env.BOT_TOKEN || !process.env.DATABASE_URL || !process.env.CLIENT_ID) {
  console.error('❌ Missing BOT_TOKEN, CLIENT_ID, or DATABASE_URL. Add them in Railway → Variables.');
  process.exit(1);
}

// === DATABASE SETUP ===
const db = new PGClient({ connectionString: process.env.DATABASE_URL });
await db.connect();

// Create or update table
await db.query(`
  CREATE TABLE IF NOT EXISTS purge_configs (
    id SERIAL PRIMARY KEY,
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    media_type TEXT DEFAULT 'all',
    interval_seconds INT DEFAULT 0,
    last_run TIMESTAMP DEFAULT NOW()
  );
`);

// === DISCORD CLIENT ===
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
  ],
});

// === SLASH COMMAND DEFINITIONS ===
const commands = [
  new SlashCommandBuilder()
    .setName('purge-setup')
    .setDescription('💀 Configure purge settings for your server'),
  new SlashCommandBuilder()
    .setName('purge-now')
    .setDescription('🧹 Immediately purge messages based on the configured settings'),
];

// === REGISTER SLASH COMMANDS ===
const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
try {
  console.log('📡 Registering slash commands...');
  await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), {
    body: commands,
  });
  console.log('✅ Slash commands registered globally.');
} catch (err) {
  console.error('❌ Failed to register commands:', err);
}

// === BOT READY ===
client.once('ready', () => {
  console.log(`💀 The Purge online as ${client.user.tag}`);
});

// === /purge-setup COMMAND ===
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'purge-setup') {
    const channels = interaction.guild.channels.cache
      .filter((ch) => ch.isTextBased())
      .map((ch) => ({ label: `#${ch.name}`, value: ch.id }));

    const channelMenu = new StringSelectMenuBuilder()
      .setCustomId('select_channel')
      .setPlaceholder('Select a channel to purge')
      .addOptions(channels.slice(0, 25)); // Max 25

    const mediaMenu = new StringSelectMenuBuilder()
      .setCustomId('select_media')
      .setPlaceholder('Select media type')
      .addOptions([
        { label: 'All Media', value: 'all' },
        { label: 'Images', value: 'attachments' },
        { label: 'Stickers', value: 'stickers' },
        { label: 'GIFs', value: 'gifs' },
        { label: 'Emojis', value: 'emojis' },
      ]);

    const embed = new EmbedBuilder()
      .setTitle('💀 The Purge Setup')
      .setDescription('Configure purge settings for your guild using the menus below.')
      .setColor('Red')
      .addFields(
        { name: 'Step 1', value: 'Select the **channel** to purge.' },
        { name: 'Step 2', value: 'Choose **media type**.' },
        { name: 'Step 3', value: 'Use `/purge-now` to execute the purge.' }
      )
      .setFooter({ text: 'The Purge - Automation System' });

    await interaction.reply({
      embeds: [embed],
      components: [
        new ActionRowBuilder().addComponents(channelMenu),
        new ActionRowBuilder().addComponents(mediaMenu),
      ],
      ephemeral: true,
    });
  }

  // === /purge-now ===
  if (interaction.commandName === 'purge-now') {
    try {
      const guildId = interaction.guild.id;
      const configRes = await db.query(
        'SELECT * FROM purge_configs WHERE guild_id = $1 LIMIT 1;',
        [guildId]
      );
      if (configRes.rowCount === 0) {
        return await interaction.reply({
          content: '⚠️ No purge configuration found. Use `/purge-setup` first.',
          ephemeral: true,
        });
      }

      const config = configRes.rows[0];
      const channel = await interaction.guild.channels.fetch(config.channel_id);

      await interaction.reply({
        content: `💀 Purging ${config.media_type} in <#${config.channel_id}>...`,
        ephemeral: true,
      });

      // Fetch and delete messages
      const messages = await channel.messages.fetch({ limit: 100 });
      const filtered = messages.filter((m) => {
        if (config.media_type === 'all') return m.attachments.size > 0 || m.stickers.size > 0;
        if (config.media_type === 'attachments') return m.attachments.size > 0;
        if (config.media_type === 'stickers') return m.stickers.size > 0;
        return false;
      });

      await Promise.allSettled(filtered.map((m) => m.delete().catch(() => null)));

      await db.query('UPDATE purge_configs SET last_run = NOW() WHERE id = $1;', [config.id]);

      await interaction.followUp({
        content: `✅ Purged ${filtered.size} messages in <#${config.channel_id}>.`,
        ephemeral: true,
      });
    } catch (err) {
      console.error('❌ Purge error:', err);
      await interaction.reply({
        content: '⚠️ Failed to purge. Check logs.',
        ephemeral: true,
      });
    }
  }
});

// === MENU INTERACTIONS ===
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isStringSelectMenu()) return;

  try {
    const guildId = interaction.guild.id;

    if (interaction.customId === 'select_channel') {
      const selectedChannel = interaction.values[0];
      await db.query(
        `
        INSERT INTO purge_configs (guild_id, channel_id)
        VALUES ($1, $2)
        ON CONFLICT (guild_id, channel_id) DO NOTHING;
        `,
        [guildId, selectedChannel]
      );
      await interaction.reply({
        content: `✅ Channel <#${selectedChannel}> selected.`,
        ephemeral: true,
      });
    }

    if (interaction.customId === 'select_media') {
      const selectedMedia = interaction.values[0];
      await db.query(
        `
        UPDATE purge_configs
        SET media_type = $1
        WHERE guild_id = $2;
        `,
        [selectedMedia, guildId]
      );
      await interaction.reply({
        content: `🎞️ Media type set to **${selectedMedia}**.`,
        ephemeral: true,
      });
    }
  } catch (err) {
    console.error('❌ Setup error:', err);
    await interaction.reply({
      content: '⚠️ Something went wrong updating your configuration.',
      ephemeral: true,
    });
  }
});

// === ERROR HANDLING ===
process.on('unhandledRejection', (err) => console.error('🚨 Unhandled Rejection:', err));
process.on('uncaughtException', (err) => console.error('💥 Uncaught Exception:', err));

// === LOGIN ===
client.login(process.env.BOT_TOKEN);
