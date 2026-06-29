# Changelog

All notable changes to ThePurge are documented here.

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
