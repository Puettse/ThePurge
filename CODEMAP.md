# 🧭 Code Map — The Purge  

> **Project:** The Purge  
> **Type:** Discord Bot (Node.js)  
> **Author:** Code Copilot  
> **Version:** 1.0.0  
> **Database:** PostgreSQL (Railway)  
> **Framework:** discord.js v14  

---

## 🏗️ Architecture Overview  

### 🔹 Core Design  
The Purge is built around a **single modular entry point (`index.js`)** that handles:  
- Discord client setup  
- Command parsing (`,p` prefix)  
- Interactive configuration menus (using message components)  
- Persistent configuration storage in PostgreSQL  
- Interval-based media deletion tasks  

### 🔹 High-Level Flow
---

## 📁 File Structure
---

## ⚙️ Module Breakdown  

### 🧠 index.js  
**Responsibilities:**
- Initialize Discord client (`discord.js`)
- Connect to PostgreSQL (`pg`)
- Create and maintain the `purge_configs` table
- Handle the `,p` and `,p stop` commands
- Manage select menu interactions for configuration
- Start and stop timed purge tasks
- Resume all active purges on startup

**Key Functions:**
| Function | Purpose |
|-----------|----------|
| `parseInterval()` | Converts user interval selections (e.g., 1h → 3600000 ms) |
| `shouldDeleteMessage()` | Checks message type against configured purge filters |
| `startPurgeTask()` | Starts interval timer to delete messages on schedule |
| `client.on('messageCreate')` | Handles prefix commands |
| `client.on('interactionCreate')` | Handles UI interactions |
| `db.query()` | Saves and retrieves purge configurations |

---

## 🗃️ Database Schema  

### Table: `purge_configs`  
Stores configuration for each active purge task.

| Column | Type | Description |
|---------|------|-------------|
| `id` | SERIAL | Primary key |
| `guild_id` | TEXT | Discord server ID |
| `channel_id` | TEXT | Discord channel ID |
| `interval_ms` | BIGINT | Purge interval in milliseconds |
| `media_types` | TEXT[] | Array of selected media types |
| `user_id` | TEXT | Optional filter by user |
| `active` | BOOLEAN | Whether purge is active |

---

## 🔁 Purge Cycle  

1. Every configured interval, the bot fetches up to 100 messages.  
2. It filters for messages containing attachments, embeds, stickers, or emojis.  
3. It deletes qualifying messages using `bulkDelete()` when possible.  
4. Console logs show channel name and number of messages deleted.  
5. Tasks are automatically restarted on bot reboot.

---

## 🧩 Dependencies  

| Package | Purpose |
|----------|----------|
| `discord.js` | Discord API wrapper for events, commands, and components |
| `pg` | PostgreSQL client for storing configurations |
| `Node.js` | Core runtime environment |

---

## 🧱 Command Map  

| Command | Type | Description |
|----------|------|-------------|
| `,p` | Prefix | Starts the purge configuration wizard |
| `,p stop` | Prefix | Stops auto-purge in current channel |

---

## 🧹 Purge Options  

| Option | Description |
|---------|-------------|
| **Interval** | Time delay between purges (30s → 1d) |
| **Media Types** | Attachments, GIFs, Stickers, Emojis, or All |
| **User Filter (coming soon)** | Limit purge to one user’s media |
| **Persistence** | Saves purge configs in SQL |

---

## ⚠️ Limitations  

- Bulk deletion can’t remove messages older than 14 days (Discord API limit).  
- Large channels may experience rate limiting; interval spacing helps.  
- Bot requires “Manage Messages” permission in each channel it purges.  

---

## 🧠 Planned Additions  

- `,p status` — show active purge configurations  
- User-targeted purge filtering  
- Optional logging channel for purge reports  
- Web dashboard for configuration (future)  

---

**End of CODEMAP**  
*“Order through automation — The Purge keeps your server clean.”*
ThePurge/
├── index.js
├── package.json
├── README.md
├── CHANGELOG.md
├── CODEMAP.md
├── LICENSE
└── .gitignore
