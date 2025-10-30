// file: index.js
import {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder
} from "discord.js";
import pkg from "pg";
import express from "express";
import fs from "fs";
const { Client: PgClient } = pkg;

// ENV
const BOT_TOKEN = process.env.BOT_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;
if (!BOT_TOKEN || !DATABASE_URL) {
  console.error("❌ Missing BOT_TOKEN or DATABASE_URL. Add them in Railway → Variables.");
  process.exit(1);
}

// HEALTH CHECK
const app = express();
app.get("/", (_, res) => res.send("OK"));
app.listen(3000, () => console.log("🩺 Health check active on port 3000"));

// VERSION
const versionData = JSON.parse(fs.readFileSync("./VERSION.json", "utf8"));
console.log(`💀 ${versionData.name} v${versionData.version} — ${versionData.codename}`);

// DISCORD CLIENT
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember]
});
const prefix = ",";
const purgeTasks = new Map();

// DB
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

// HELPERS
function parseInterval(value) {
  const map = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  const num = parseInt(value);
  const unit = value.at(-1);
  return map[unit] ? num * map[unit] : null;
}

function shouldDelete(msg, types, targetUser) {
  if (targetUser && msg.author.id !== targetUser) return false;
  if (types.includes("all"))
    return msg.attachments.size || msg.embeds.length || msg.stickers.size;
  if (types.includes("attachments") && msg.attachments.size) return true;
  if (types.includes("gifs") && msg.embeds.some(e => e.url?.includes(".gif"))) return true;
  if (types.includes("stickers") && msg.stickers.size) return true;
  if (types.includes("emojis") && /<:.+?:\d+>/.test(msg.content)) return true;
  return false;
}

async function startTask(guildId, channelId, intervalMs, types, userId, logChannelId) {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  const log = logChannelId ? await client.channels.fetch(logChannelId).catch(() => null) : null;
  if (!channel) return;

  const loop = setInterval(async () => {
    try {
      const msgs = await channel.messages.fetch({ limit: 100 });
      const del = msgs.filter(m => shouldDelete(m, types, userId));
      for (const m of del.values()) await m.delete().catch(() => {});
      if (del.size)
        log?.send(`🧹 Purged ${del.size} message(s) in ${channel}`).catch(() => {});
    } catch (e) {
      console.error("purge loop error:", e.message);
    }
  }, intervalMs);

  purgeTasks.set(channelId, loop);
}

// RESTORE ON START
client.once("ready", async () => {
  console.log(`💀 The Purge ready as ${client.user.tag}`);
  const res = await db.query("SELECT * FROM purge_configs WHERE active=true");
  for (const r of res.rows)
    startTask(r.guild_id, r.channel_id, r.interval_ms, r.media_types, r.user_id, r.log_channel_id);
});

// SAFE COLLECT FUNCTION WITH RETRIES
async function collectInput(channel, userId, question, validateFn) {
  const filter = m => m.author.id === userId;
  for (let i = 0; i < 3; i++) {
    await channel.send(question);
    const collected = await channel
      .awaitMessages({ filter, max: 1, time: 60000 })
      .catch(() => null);
    const input = collected?.first()?.content?.trim();
    if (!input) {
      await channel.send("⏰ Timeout or no input. Please try again.");
      continue;
    }
    if (input.toLowerCase() === "cancel") throw new Error("cancelled");
    const valid = await validateFn(input);
    if (valid) return valid;
    await channel.send("⚠️ Invalid input, please try again.");
  }
  throw new Error("too many attempts");
}

// COMMANDS
client.once('clientReady', () => {
  console.log(`💀 The Purge ready as ${client.user.tag}`);
});
  const args = msg.content.slice(prefix.length).trim().split(/\s+/);
  const cmd = args.shift()?.toLowerCase();

  try {
    // version
    if (cmd === "version")
      return msg.reply(
        `💀 **${versionData.name}** v${versionData.version}\n🧾 ${versionData.codename}\n📅 ${versionData.release_date}`
      );

    // status
    if (cmd === "p" && args[0] === "status") {
      const res = await db.query("SELECT * FROM purge_configs WHERE guild_id=$1 AND active=true", [msg.guild.id]);
      if (!res.rowCount) return msg.reply("💤 No active purges.");
      const list = res.rows
        .map(r => `#${msg.guild.channels.cache.get(r.channel_id)?.name} → ${r.media_types.join(", ")} every ${r.interval_ms / 1000}s`)
        .join("\n");
      return msg.reply({ embeds: [new EmbedBuilder().setColor(0xff0000).setTitle("💀 Active Purges").setDescription(list)] });
    }

    // stop
    if (cmd === "p" && args[0] === "stop") {
      await db.query("UPDATE purge_configs SET active=false WHERE channel_id=$1", [msg.channel.id]);
      clearInterval(purgeTasks.get(msg.channel.id));
      purgeTasks.delete(msg.channel.id);
      return msg.reply("🛑 Purge stopped for this channel.");
    }

    // setup
    if (cmd === "p" && !args[0]) {
      const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle("💀 The Purge Setup Wizard")
        .setDescription(
          "We'll set up a purge task in four steps:\n" +
          "1️⃣ Channel\n2️⃣ Interval\n3️⃣ Media types\n4️⃣ Target user (optional)\n\nType `cancel` anytime to stop."
        );
      await msg.reply({ embeds: [embed] });

      const collected = {};

      // Step 1: Channel
      collected.channelId = await collectInput(
        msg.channel,
        msg.author.id,
        "📂 Please mention the channel or type its name:",
        async input => {
          const ch = msg.mentions.channels.first() || msg.guild.channels.cache.find(c => c.name === input.replace("#", ""));
          return ch?.isTextBased() ? ch.id : null;
        }
      );

      // Step 2: Interval
      collected.intervalMs = await collectInput(
        msg.channel,
        msg.author.id,
        "⏱️ Enter interval (e.g., 30s, 5m, 1h, 1d):",
        async input => parseInterval(input)
      );

      // Step 3: Media types
      collected.mediaTypes = await collectInput(
        msg.channel,
        msg.author.id,
        "🧩 Enter media types (comma separated: attachments,gifs,stickers,emojis,all):",
        async input => {
          const parts = input.split(",").map(t => t.trim().toLowerCase());
          const valid = ["attachments", "gifs", "stickers", "emojis", "all"];
          return parts.every(p => valid.includes(p)) ? parts : null;
        }
      );

      // Step 4: Target user (optional)
      collected.userId = await collectInput(
        msg.channel,
        msg.author.id,
        "👤 Mention a user to target (or type 'none'):",
        async input => {
          if (input.toLowerCase() === "none") return null;
          const user = msg.mentions.users.first() || msg.guild.members.cache.find(m => m.user.username === input)?.user;
          return user?.id || null;
        }
      ).catch(() => null);

      await db.query(
        `INSERT INTO purge_configs (guild_id, channel_id, interval_ms, media_types, user_id, active)
         VALUES ($1,$2,$3,$4,$5,true)
         ON CONFLICT (channel_id) DO UPDATE SET interval_ms=EXCLUDED.interval_ms, media_types=EXCLUDED.media_types, user_id=EXCLUDED.user_id, active=true`,
        [msg.guild.id, collected.channelId, collected.intervalMs, collected.mediaTypes, collected.userId]
      );

      if (purgeTasks.has(collected.channelId))
        clearInterval(purgeTasks.get(collected.channelId));

      startTask(msg.guild.id, collected.channelId, collected.intervalMs, collected.mediaTypes, collected.userId);

      const confirm = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle("✅ Purge Task Created")
        .setDescription(
          `Channel: <#${collected.channelId}>\nInterval: ${collected.intervalMs / 1000}s\nMedia: ${collected.mediaTypes.join(", ")}\nUser: ${
            collected.userId ? `<@${collected.userId}>` : "None"
          }`
        );
      return msg.reply({ embeds: [confirm] });
    }
  } catch (err) {
    if (err.message === "cancelled") return msg.reply("❌ Setup cancelled.");
    if (err.message === "too many attempts") return msg.reply("🚫 Too many invalid attempts. Setup aborted.");
    console.error("⚠️ Command error:", err);
    return msg.reply("💥 An unexpected error occurred. Please try again.");
  }
});

client.login(BOT_TOKEN);
