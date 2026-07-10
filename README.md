# ThePurge

ThePurge is an all-in-one Discord bot for moderation, automation, ticketing, server engagement, and dashboard-based control.

The current implementation is designed for Railway with Node.js, discord.js v14, PostgreSQL, and a built-in Express dashboard.

## Implemented Core

- Slash command registry for setup, dashboard, invite, purge, moderation, automod, logs, custom commands, welcome, autoroles, scheduling, rank, economy, and tickets.
- Discord bot gateway with message, member, reaction, interaction, and guild lifecycle event handlers.
- PostgreSQL schema for guild settings, modules, audit events, moderation cases, purge configs, scheduled jobs, custom commands, automod rules, reaction roles, ticket panels, tickets, ticket transcripts, levels, economy accounts, and dashboard users.
- Dashboard/control panel served from the same Railway service.
- Discord OAuth dashboard login using `identify` and `guilds` scopes.
- Server-side dashboard access filtering to guilds where the logged-in Discord user can manage the server.
- Server-sent live feed for bot status, audit events, errors, dashboard events, and scheduler events.
- Ticketing control inspired by ticket panel workflows: panel creation, private ticket channels, staff roles, claim, close, and stored transcripts.
- Feature isolation boundaries: Discord commands are lazy-loaded by feature, dashboard routes are lazy-loaded by module, event handlers run through per-feature guards, and dashboard overview sections degrade independently.
- Purge integrity controls: per-channel purge command, scheduled purge jobs, media matching for attachments/GIFs/stickers/emojis, bot permission checks, paginated message inspection, and honest delete/failure counts.
- Invite controls: Manage Server users can create one-use server invites and send them by DM to a Discord user ID or username already visible to the bot.
- Remote Ops voice bridge: dashboard voice join/leave, live self mute/deaf updates, hold-to-talk microphone transmission, screen/app audio transmission when the browser exposes it, inbound voice monitoring, protected voice activity records, and protected 30-second WAV clips.

## Module Isolation Rule

No feature should be so tightly coupled to another feature that one outage takes unrelated capability down with it.

- Discord command handlers live under `src/bot/handlers/` and are loaded by command name.
- Dashboard module APIs live under `src/web/routes/modules/` and are loaded behind route boundaries.
- Event-driven features such as AutoMod, custom commands, leveling, welcome, autoroles, and reaction roles run independently.
- Dashboard overview data returns `sectionErrors` when one section fails instead of failing the whole dashboard.
- Shared services are allowed for cross-cutting concerns such as database access, audit events, permissions, templates, and live feed, but feature code must not import another feature module directly.

## Commands

- `/setup`
- `/dashboard`
- `/invite`
- `/purge`
- `/mod`
- `/automod`
- `/logs`
- `/custom-command`
- `/welcome`
- `/autorole`
- `/schedule`
- `/rank`
- `/economy`
- `/ticket`

## Railway Variables

Copy `.env.example` and set equivalent Railway variables:

| Variable | Required | Purpose |
| --- | --- | --- |
| `BOT_TOKEN` | Yes | Discord bot token. |
| `CLIENT_ID` | Yes | Discord application client ID. |
| `CLIENT_SECRET` | Dashboard | Discord OAuth secret for dashboard login. |
| `DATABASE_URL` | Yes | PostgreSQL connection string. |
| `PUBLIC_BASE_URL` | Dashboard | Public Railway URL, used for OAuth callback. Defaults to `https://thepurge-production.up.railway.app` when not set. |
| `SESSION_SECRET` | Dashboard | Long random string for dashboard cookies. |
| `PORT` | Railway | HTTP port, defaults to `3000`. |
| `NODE_ENV` | Recommended | Use `production` on Railway. |

Dashboard OAuth callback URL:

```text
https://thepurge-production.up.railway.app/auth/callback
```

Railway deployment config is pinned in `railway.json`:

- Builder: Railpack
- Start command: `npm start`
- Health check: `/health`
- Restart policy: `ON_FAILURE` with bounded retries

## Local Commands

```bash
npm install
npm start
npm test
```

If PowerShell blocks npm shims on Windows, use:

```powershell
npm.cmd install
npm.cmd test
```

## Current Limits

- Full dashboard runtime requires Discord OAuth variables and a live bot token.
- Full test suite requires dependencies to install successfully.
- Sharding, premium/billing, and music are intentionally out of v1 scope.
- Ticket transcripts store the most recent 100 channel messages at close time.
- Invite-by-username only works for users already visible to the bot; Discord does not provide global username search to bot tokens, so user ID is the reliable target.
- Voice clip transcription rows are created with `not_configured` status until a speech-to-text provider is added.
