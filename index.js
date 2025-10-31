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

// --- ENVIRONMENT CHECK ---
if (!process.env.BOT_TOKEN || !process.env.DATABASE_URL) {
  console.error('❌ Missing BOT_TOKEN or DATABASE_URL. Add them in Railway → Variables.');
  process.exit(1);
}

// --- DATABASE SETUP ---
const db = new PGClient({ connectionString: process.env.DATABASE_URL });
await db.connect();

// ✅ Create table if not exists (simplified & fixed)
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

// --- DISCORD CLIENT ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
  ],
});

// --- SLASH COMMANDS SETUP ---
const commands = [
  new SlashCommandBuilder()
    .setName('purge-setup')
    .setDescription('💀 Configure The Purge settings for this server'),
  new SlashCommandBuilder()
    .setName('purge-now')
    .setDescription('🧹 Immediately purge configured media from this channel'),
];

// --- REGISTER SLASH COMMANDS ---
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

// --- BOT READY EVENT ---
client.once('ready', () => {
  console.log(`💀 The Purge ready as ${client.user.tag}`);
});

// === COMMAND HANDLER ===
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'purge-setup') {
    // --- STEP 1: Channel Selector ---
    const channels = interaction.guild.channels.cache
      .filter((ch) => ch.isTextBased())
      .map((ch) => ({
        label: `#${ch.name}`,
        value: ch.id,
      }));

    const channelMenu = new StringSelectMenuBuilder()
      .setCustomId('select_channel')
      .setPlaceholder('Select a channel to purge')
      .addOptions(channels.slice(0, 25)); // Discord max is 25

    const mediaMenu = new StringSelectMenuBuilder()
      .setCustomId('select_media')
      .setPlaceholder('Select media type to purge')
      .addOptions([
        { label: 'All Media', value: 'all' },
        { label: 'Images', value: 'attachments' },
        { label: 'Stickers', value: 'stickers' },
        { label: 'GIFs', value: 'gifs' },
        { label: 'Emojis', value: 'emojis' },
      ]);

    const embed = new EmbedBuilder()
      .setTitle('💀 The Purge Setup')
      .setDescription('Follow the menus below to configure purge settings.')
      .setColor('Red')
      .addFields(
        { name: 'Step 1', value: 'Select the **channel** to purge.' },
        { name: 'Step 2', value: 'Choose **media type**.' },
        { name: 'Step 3', value: 'Set **interval** with `/purge-setup interval:<time>`' },
      );

    await interaction.reply({
      embeds: [embed],
      components: [
        new ActionRowBuilder().addComponents(channelMenu),
        new ActionRowBuilder().addComponents(mediaMenu),
      ],
      ephemeral: true,
    });
  }
});

// === MENU INTERACTIONS ===
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isStringSelectMenu()) return;

  try {
    if (interaction.customId === 'select_channel') {
      const selectedChannel = interaction.values[0];
      await db.query(
        `INSERT INTO purge_configs (guild_id, channel_id)
         VALUES ($1, $2)
         ON CONFLICT (guild_id, channel_id) DO NOTHING;`,
        [interaction.guild.id, selectedChannel]
      );
      await interaction.reply({ content: `✅ Channel <#${selectedChannel}> selected.`, ephemeral: true });
    }

    if (interaction.customId === 'select_media') {
      const selectedMedia = interaction.values[0];
      await db.query(
        `UPDATE purge_configs
         SET media_type = $1
         WHERE guild_id = $2
         RETURNING *;`,
        [selectedMedia, interaction.guild.id]
      );
      await interaction.reply({ content: `🎞️ Media type set to **${selectedMedia}**.`, ephemeral: true });
    }
  } catch (err) {
    console.error('❌ Error saving setup:', err);
    await interaction.reply({ content: '⚠️ Something went wrong saving your setup.', ephemeral: true });
  }
});

// === GLOBAL ERROR HANDLERS ===
process.on('unhandledRejection', (err) => console.error('🚨 Unhandled Rejection:', err));
process.on('uncaughtException', (err) => console.error('💥 Uncaught Exception:', err));

// === LOGIN ===
client.login(process.env.BOT_TOKEN);
