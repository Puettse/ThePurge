// File: index.js
import { Client, GatewayIntentBits, EmbedBuilder } from "discord.js";
import pkg from "pg";
import dotenv from "dotenv";

dotenv.config();
const { Client: PGClient } = pkg;

// === Verify Environment ===
if (!process.env.BOT_TOKEN || !process.env.DATABASE_URL) {
  console.error("❌ Missing BOT_TOKEN or DATABASE_URL. Add them in Railway → Variables.");
  process.exit(1);
}

// === Database Setup ===
const db = new PGClient({ connectionString: process.env.DATABASE_URL });
await db.connect();
await db.query(`
CREATE TABLE IF NOT EXISTS purge_configs (
  id SERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  media_type TEXT DEFAULT 'all',
  user_id TEXT,
  interval_seconds INT DEFAULT 0,
  last_run TIMESTAMP DEFAULT NOW()
)`);

// === Discord Client ===
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// === Ready Event ===
client.once("clientReady", () => {
  console.log(`💀 The Purge ready as ${client.user.tag}`);
  setInterval(runScheduledPurges, 60_000); // check every 60s
});

// === Command Handler ===
client.on("messageCreate", async (msg) => {
  try {
    if (msg.author.bot || !msg.guild) return;
    if (!msg.content.startsWith(",")) return;

    const args = msg.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // ---- ,p command ----
    if (command === "p") {
      const embed = new EmbedBuilder()
        .setTitle("💀 The Purge Setup")
        .setDescription("Reply below with step numbers to configure purge settings.")
        .addFields(
          { name: "1️⃣ Channel", value: "Mention or paste channel ID." },
          { name: "2️⃣ Interval", value: "Time before purge (e.g., `10m`, `2h`, `1d`)." },
          { name: "3️⃣ Media Type", value: "`media`, `attachments`, `stickers`, `gifs`, `emojis`, or `all`." },
          { name: "4️⃣ User (optional)", value: "Mention user or `all`." }
        )
        .setColor("Red")
        .setFooter({ text: "Type cancel to abort." });

      await msg.reply({ embeds: [embed] });

      const filter = (m) => m.author.id === msg.author.id;
      const collector = msg.channel.createMessageCollector({ filter, time: 60_000 });

      const config = { guild_id: msg.guild.id };
      let step = 1;

      msg.reply("➡️ Step 1: Please mention the channel to purge.");
      collector.on("collect", async (m) => {
        const content = m.content.trim();
        if (content.toLowerCase() === "cancel") {
          await msg.reply("❌ Purge setup cancelled.");
          collector.stop();
          return;
        }

        try {
          if (step === 1) {
            const channelId = content.match(/\d+/)?.[0];
            const channel = msg.guild.channels.cache.get(channelId);
            if (!channel) return msg.reply("⚠️ Invalid channel. Try again.");
            config.channel_id = channel.id;
            step++;
            return msg.reply("➡️ Step 2: Enter interval (e.g., `30s`, `10m`, `2h`, `1d`).");
          }

          if (step === 2) {
            const match = content.match(/(\d+)\s*([smhd])/i);
            if (!match) return msg.reply("⚠️ Invalid time format. Use s, m, h, or d.");
            const mult = { s: 1, m: 60, h: 3600, d: 86400 }[match[2].toLowerCase()];
            config.interval_seconds = parseInt(match[1]) * mult;
            step++;
            return msg.reply("➡️ Step 3: Choose media type (`media`, `attachments`, `stickers`, `gifs`, `emojis`, or `all`).");
          }

          if (step === 3) {
            const valid = ["media", "attachments", "stickers", "gifs", "emojis", "all"];
            if (!valid.includes(content.toLowerCase()))
              return msg.reply("⚠️ Invalid type. Try again.");
            config.media_type = content.toLowerCase();
            step++;
            return msg.reply("➡️ Step 4: Mention a user or type `all`.");
          }

          if (step === 4) {
            const userId = content.match(/\d+/)?.[0];
            config.user_id = userId || null;

            await db.query(
              `INSERT INTO purge_configs (guild_id, channel_id, media_type, user_id, interval_seconds)
               VALUES ($1,$2,$3,$4,$5)
               ON CONFLICT DO NOTHING`,
              [
                config.guild_id,
                config.channel_id,
                config.media_type,
                config.user_id,
                config.interval_seconds,
              ]
            );
            await msg.reply("✅ Purge configuration saved.");
            collector.stop();
          }
        } catch (err) {
          console.error("❌ Setup error:", err);
          await msg.reply("⚠️ Something went wrong, try again.");
        }
      });
    }
  } catch (err) {
    console.error("❌ Error handling message:", err);
  }
});

// === Purge Runner ===
async function runScheduledPurges() {
  try {
    const { rows } = await db.query("SELECT * FROM purge_configs");
    for (const cfg of rows) {
      const now = Date.now();
      const since = new Date(cfg.last_run).getTime();
      if (now - since < cfg.interval_seconds * 1000) continue;

      const guild = await client.guilds.fetch(cfg.guild_id).catch(() => null);
      if (!guild) continue;
      const channel = await guild.channels.fetch(cfg.channel_id).catch(() => null);
      if (!channel || !channel.isTextBased()) continue;

      const msgs = await channel.messages.fetch({ limit: 100 });
      const targets = msgs.filter((m) => {
        if (cfg.user_id && m.author.id !== cfg.user_id) return false;
        if (cfg.media_type === "all") return hasMedia(m);
        if (cfg.media_type === "attachments") return m.attachments.size > 0;
        if (cfg.media_type === "stickers") return m.stickers.size > 0;
        if (cfg.media_type === "gifs") return /https:\/\/tenor|giphy/i.test(m.content);
        if (cfg.media_type === "emojis") return /<a?:\w+:\d+>/.test(m.content);
        if (cfg.media_type === "media") return hasMedia(m);
        return false;
      });

      if (targets.size > 0) await channel.bulkDelete(targets, true);
      await db.query("UPDATE purge_configs SET last_run = NOW() WHERE id = $1", [cfg.id]);
      console.log(`🧹 Purged ${targets.size} messages in #${channel.name}`);
    }
  } catch (err) {
    console.error("❌ Purge loop error:", err);
  }
}

// === Helpers ===
function hasMedia(m) {
  return (
    m.attachments.size > 0 ||
    m.stickers.size > 0 ||
    /https:\/\/tenor|giphy|cdn\.discordapp\.com/.test(m.content)
  );
}

// === Global Error Handling ===
process.on("unhandledRejection", (err) => console.error("🚨 Unhandled:", err));
process.on("uncaughtException", (err) => console.error("💥 Uncaught:", err));

// === Login ===
client.login(process.env.BOT_TOKEN);
