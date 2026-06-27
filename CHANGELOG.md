# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.2] - 2026-06-27

### Fixed
- Root `index.ts` entry point used `.js` extension instead of `.ts` — extension failed to load from source in dev mode

## [0.1.1] - 2026-06-27

### Fixed
- Clean `dist/` before build to prevent stale artifacts from reverted features in npm tarball

## [0.1.0] - 2026-06-08

### Added
- `/power-settings` command with interactive toggle menu
- **Yellow Session Name** — shows named sessions in yellow in the footer, matching the session picker color
- **Compact Model** — use a dedicated model for context compaction, independent of the active conversation model, with fallback chain to session model and default compaction
- **Hostname in Footer** — shows the machine hostname in the footer status line
- Configuration persistence in `~/.pi/agent/pi-power-toys.json`
- Pluggable feature architecture via `PowerToyFeature` interface

[Unreleased]: https://github.com/andrea-tomassi/pi-power-toys/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/andrea-tomassi/pi-power-toys/releases/tag/v0.1.1
[0.1.0]: https://github.com/andrea-tomassi/pi-power-toys/releases/tag/v0.1.0
