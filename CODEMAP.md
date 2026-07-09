# Code Map

Last updated: 2026-07-05

## Runtime Entry

- `index.js` starts the application through `src/main.js`.
- `src/main.js` loads configuration, connects PostgreSQL, runs migrations, creates the Discord client, registers commands, starts the scheduler, and serves the dashboard.

## Configuration and Data

- `src/config.js` reads Railway, Discord, and PostgreSQL environment variables.
- `src/db/index.js` creates the PostgreSQL client, owns schema migration, records known modules, and ensures guild defaults.
- `remote_voice_events` and `remote_voice_clips` store protected dashboard-only voice activity records and WAV clips.
- `railway.json` pins Railway build/deploy config, health check, and restart policy.

## Discord Bot

- `src/bot/client.js` configures Discord gateway intents and partials.
- `src/bot/commands.js` defines public slash commands.
- `src/bot/registerCommands.js` registers global application commands.
- `src/bot/events.js` wires guild, message, member, reaction, and interaction handlers.
- `src/bot/interactions.js` routes interactions through lazy-loaded feature handlers.
- `src/bot/handlers/` contains independently loaded command modules for setup, moderation, automation, logs, engagement, and tickets.

## Services

- `src/services/auditService.js` writes audit events and publishes live-feed updates.
- `src/services/liveFeed.js` maintains in-memory dashboard event history and subscribers.
- `src/services/templateEngine.js` renders safe variables for custom commands, welcome messages, schedules, and logs.
- `src/services/permissionService.js` centralizes Discord permission and role-hierarchy checks.
- `src/services/moderationService.js` runs moderation actions and media purge filtering.
- `src/services/mediaService.js` owns media matching, paginated message fetches, Manage Messages permission checks, and deletion result counts.
- `src/services/automodService.js` evaluates message events against stored automation rules.
- `src/services/scheduler.js` runs recurring message and purge jobs.
- `src/services/schedulerTasks.js` contains scheduler task helpers.
- `src/services/ticketService.js` creates ticket panels, opens private channels, claims tickets, closes tickets, and stores transcripts.
- `src/services/remoteControlService.js` owns dashboard remote messages, file sends, voice joins/leaves, dashboard audio transmission, inbound voice receiving, and protected voice records/clips.

## Dashboard

- `src/web/server.js` serves static dashboard files and JSON/SSE APIs.
- `src/web/auth.js` handles Discord OAuth and signed HTTP-only dashboard sessions.
- `src/web/remoteVoiceBridge.js` authenticates dashboard voice WebSocket upgrades for outbound dashboard audio and inbound Discord voice monitoring.
- `src/web/webActions.js` contains dashboard-triggered moderation actions.
- `src/web/routes/` composes dashboard routes with lazy-loaded module boundaries.
- `src/web/routes/modules/` contains independently loaded dashboard modules for settings, overview, automation, moderation, tickets, and remote ops.
- `public/index.html`, `public/styles.css`, and `public/app.js` implement the browser control panel.

## Scripts and Tests

- `scripts/fix_db.js` is legacy database repair tooling.
- `tests/*.test.js` cover pure shared behavior that can run without live Discord/Railway services.
- `docs/code-reviews/*.md` stores lifecycle code review records for significant changes.

## Important Operational Notes

- The local folder is a Git checkout on branch `main`.
- Runtime requires `BOT_TOKEN`, `CLIENT_ID`, and `DATABASE_URL`.
- Dashboard OAuth requires `CLIENT_SECRET`, `PUBLIC_BASE_URL`, and `SESSION_SECRET`.
- Full validation requires successful npm dependency installation.
- Feature modules should not import other feature modules directly; use shared services for cross-cutting behavior.
