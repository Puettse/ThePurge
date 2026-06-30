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
- Feature isolation boundaries: Discord commands are lazy-loaded by feature, dashboard routes are lazy-loaded by module, event handlers run through per-feature guards, and dashboard overview sections degrade independently.
- Purge integrity controls: per-channel purge command, scheduled purge jobs, media matching for attachments/GIFs/stickers/emojis, bot permission checks, paginated message inspection, and honest delete/failure counts.
- Remote Ops voice bridge: dashboard voice join/leave, live self mute/deaf updates, hold-to-talk microphone transmission, screen/app audio transmission when the browser exposes it, inbound voice playback, protected voice activity records, and protected 30-second WAV clips.
- Jellyfin dashboard access: server-side API calls expose system status, libraries, active sessions, and recent activity without sending the API key to the browser.
- Jellyfin bot catalogue: dashboard title sync, per-title bot access toggles, and `/catalog` browsing by genre, year, or actor with Jellyfin title links.

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
- `/catalog`
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
| `JELLYFIN_BASE_URL` | Jellyfin | Public or Railway-reachable Jellyfin server URL. Do not use `localhost` on Railway unless Jellyfin runs in the same service container. |
| `JELLYFIN_API_KEY` | Jellyfin | Jellyfin API key used only by the server-side dashboard proxy. |
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

## Jellyfin Tunnel

For a temporary proof tunnel from this Windows machine to local Jellyfin:

```powershell
npm.cmd run tunnel:jellyfin:quick
```

For the permanent EBMSOL tunnel route, authenticate Cloudflare for `ebmsol.com`, then run:

```powershell
npm.cmd run tunnel:jellyfin:setup -- -Login -CreateScheduledTask -StartNow
```

The stable Railway value should be:

```text
JELLYFIN_BASE_URL=https://jellyfin.ebmsol.com
```

## Current Limits

- Full dashboard runtime requires Discord OAuth variables and a live bot token.
- Full test suite requires dependencies to install successfully.
- Sharding, premium/billing, and music are intentionally out of v1 scope.
- Ticket transcripts store the most recent 100 channel messages at close time.
- Discord bot accounts cannot capture other users' Discord camera/screen video streams through the official bot voice API. Voice activity and voice audio clips are supported; video recording needs a separate user/client capture path.
- Voice clip transcription rows are created with `not_configured` status until a speech-to-text provider is added.
