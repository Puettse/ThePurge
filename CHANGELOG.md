# Changelog

All notable changes to ThePurge are documented here.

## [4.4.0] - 2026-07-10

### Added

- Added dashboard-only Server Builder for uploading, validating, previewing, and applying YAML/JSON Discord server blueprints.
- Added PostgreSQL-backed Server Builder config storage, key-to-Discord-ID mappings, run history, and local mirrored config files.
- Added the Domus-Ursi Server Builder example config under `docs/server-builder.example.yaml`.

### Security

- Server Builder apply actions require Discord Administrator permission and are not exposed through slash commands or prefix commands.
- Server Builder blocks deletes, Administrator grants, and role position moves unless the uploaded config explicitly enables the matching `danger_zone` flag.

### Fixed

- Changed Server Builder `CREATE` mode to accept a fresh Discord server with default starter channels/categories instead of requiring a literally empty guild.

## [4.3.10] - 2026-07-10

### Added

- Added a Manage Server invite workflow in the bot and control panel for sending one-use server invite links by user ID or known username.

## [4.3.9] - 2026-07-05

### Changed

- Removed a retired integration from the dashboard, bot commands, route modules, configuration, tests, scripts, and docs.

## [4.3.5] - 2026-06-30

### Added

- Added inbound Discord voice monitoring through the `@discordjs/voice` receiver, `opusscript` Opus decoding, and an authenticated dashboard WebSocket.
- Added browser playback for inbound voice chat audio from the dashboard.
- Added protected voice activity records and protected 30-second WAV clips stored behind dashboard authentication.
- Added dashboard controls to refresh and play protected voice clips.

### Changed

- Changed dashboard microphone control to push-to-talk with a hold-to-talk button instead of continuous active mic streaming.
- Added live dashboard updates for bot self mute and self deaf state after joining voice.
- Added an authenticated voice state route so self mute/deaf checkboxes update the active Discord voice connection.

### Known Limits

- Voice clip transcription records are stored with `not_configured` status until a speech-to-text provider is wired in.

## [4.3.2] - 2026-06-30

### Added

- Added an authenticated Remote Ops audio WebSocket for transmitting dashboard audio into the bot's current Discord voice connection.
- Added dashboard microphone controls, screen/app capture controls, captured-audio mixing, source display, and local screen preview.
- Added Remote Ops voice status fields for self mute, self deaf, and active dashboard audio transmission.

### Changed

- Directly declared `ws` as a runtime dependency for dashboard audio sockets.

### Known Issues

- Incoming Discord voice monitoring still requires a browser-playable receiver/decoder layer.

## [4.3.1] - 2026-06-28

### Fixed

- Fixed local and Railway dashboard startup so the web UI binds before Discord and PostgreSQL initialization.
- Added degraded `/health` and `/api/health` reporting for missing config, database errors, and Discord startup errors.
- Added a regression test for dashboard health when required environment variables are missing.

## [4.3.0] - 2026-06-28

### Added

- Added `/schedule purge` for recurring media purges.
- Added migration from legacy `purge_configs.interval_seconds` rows into scheduled purge jobs.
- Added dedupe migration before the `(guild_id, channel_id)` purge config unique index.
- Added shared `mediaService` for media matching, purge pagination, delete counting, and Manage Messages permission checks.
- Added tests for scheduled purge command registration, GIF embed matching, and paginated message fetches.

### Changed

- Changed manual purge output to report inspected, matched, deleted, and failed counts.
- Changed scheduled purge to use the shared media service instead of depending on moderation feature internals.

## [4.2.0] - 2026-06-28

### Added

- Added explicit module isolation documentation to README.
- Added `railway.json` config-as-code with start command, health check, and bounded restart policy.

### Changed

- Split Discord command handling into lazy-loaded feature modules under `src/bot/handlers/`.
- Split dashboard API handling into lazy-loaded feature route modules under `src/web/routes/modules/`.
- Changed Discord event processing so AutoMod, custom commands, leveling, welcome, autoroles, and reaction roles fail independently.
- Changed dashboard overview loading so individual section failures are reported in `sectionErrors` instead of failing the whole overview response.

## [4.1.0] - 2026-06-28

### Added

- Added built-in Express dashboard/control panel hosted by the same Railway service.
- Added Discord OAuth dashboard login with guild management filtering.
- Added server-sent live feed for bot health, audit events, errors, scheduler activity, and dashboard changes.
- Added modular Discord bot architecture with command registry, event handlers, service layer, database migration, scheduler, and dashboard API.
- Added moderation commands for purge, warn, timeout, kick, and ban.
- Added AutoMod rule storage and message-event enforcement for invite links, links, blocked words, attachments, and mention limits.
- Added shared audit log table and moderation case tracking.
- Added custom command storage and template rendering.
- Added welcome/leave message configuration.
- Added autorole and reaction-role persistence.
- Added scheduled message and scheduled purge job support.
- Added leveling and starter economy account tables and commands.
- Added ticketing control with ticket panels, private ticket channels, staff role access, claim, close, and transcript storage.
- Added `.env.example` and focused node:test coverage for template rendering, live feed behavior, command names, and media matching.

### Changed

- Replaced the single-file bot implementation with a modular `src/` architecture.
- Updated package metadata from purge-only bot to all-in-one bot.
- Updated README and CODEMAP to describe the new runtime.

### Security

- Dashboard sessions use HTTP-only cookies.
- Dashboard API filters guild access to Discord guilds where the logged-in user has owner, Administrator, or Manage Server access.
- Custom command rendering suppresses `@everyone` and `@here` unless explicitly allowed.

### Known Issues

- Full dashboard OAuth validation requires live Railway variables and Discord application callback configuration.
- Full Discord ticketing validation requires a test server where the bot has channel, role, and moderation permissions.

## [1.0.0] - 2025-10-30

### Added

- Initial purge-focused Discord bot baseline.
