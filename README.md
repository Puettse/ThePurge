# ThePurge

ThePurge is an all-in-one Discord bot for moderation, automation, ticketing, server engagement, and dashboard-based control.

The current implementation is designed for Railway with Node.js, discord.js v14, PostgreSQL, and a built-in Express dashboard.

## Implemented Core

- Slash command registry for setup, dashboard, purge, moderation, automod, logs, custom commands, welcome, autoroles, scheduling, rank, economy, and tickets.
- Discord bot gateway with message, member, reaction, interaction, and guild lifecycle event handlers.
- PostgreSQL schema for guild settings, modules, audit events, moderation cases, purge configs, scheduled jobs, custom commands, automod rules, reaction roles, ticket panels, tickets, ticket transcripts, levels, economy accounts, and dashboard users.
- Dashboard/control panel served from the same Railway service.
- Discord OAuth dashboard login using `identify` and `guilds` scopes.
- Server-side dashboard access filtering to guilds where the logged-in Discord user can manage the server.
- Server-sent live feed for bot status, audit events, errors, dashboard events, and scheduler events.
- Ticketing control inspired by ticket panel workflows: panel creation, private ticket channels, staff roles, claim, close, and stored transcripts.

## Commands

- `/setup`
- `/dashboard`
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
| `PUBLIC_BASE_URL` | Dashboard | Public Railway URL, used for OAuth callback. |
| `SESSION_SECRET` | Dashboard | Long random string for dashboard cookies. |
| `PORT` | Railway | HTTP port, defaults to `3000`. |
| `NODE_ENV` | Recommended | Use `production` on Railway. |

Dashboard OAuth callback URL:

```text
https://your-railway-domain.up.railway.app/auth/callback
```

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
