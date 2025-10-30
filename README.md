# 💀 The Purge

> *"One night a year, all media shall be deleted."*

**The Purge** is a fully automated Discord bot that purges media messages —  
attachments, GIFs, stickers, and emojis — from selected channels on a schedule.  
It’s built using **Node.js**, **discord.js v14**, and **PostgreSQL** (via **Railway**).  

---

## ⚙️ Features

- 🧩 Interactive setup using the command `,p`
- 🕒 Select purge interval (seconds, minutes, hours, days)
- 📂 Choose media types (attachments, GIFs, stickers, emojis, or all)
- 💾 SQL persistence (saves config in PostgreSQL)
- 🔁 Auto-resumes purge tasks after restart
- 🛑 `,p stop` command to stop purging a channel

---

## 🚀 Deployment (on Railway)

### 1️⃣ Connect GitHub
- Go to [Railway.app](https://railway.app/)
- Create a new project → **Deploy from GitHub**
- Select your repo **ThePurge**

### 2️⃣ Add Environment Variables
Go to your Railway project → **Variables tab** → Add:

| Variable | Example | Description |
|-----------|----------|-------------|
| `BOT_TOKEN` | `MTQx...` | Your Discord bot token |
| `DATABASE_URL` | `postgresql://user:pass@host:port/dbname` | Railway PostgreSQL URL |

### 3️⃣ Deploy
Railway automatically detects Node.js:
