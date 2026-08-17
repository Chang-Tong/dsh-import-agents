# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.4] - 2026-08-15

### Added

- Declared `dsh.bundle` with the bundled `cordis.patch.yml`, so the plugin is now installable with the official one-command installer and activates automatically:

  ```sh
  dsh plugin --profile web add dsh-import-agents
  ```

  No manual profile editing needed (the manual `pnpm add` + `cordis.patch.yml` flow still works as a fallback).

## [0.2.3] - 2026-08-14

### Changed

- English-ized plugin output: the Sync button label is now locale-aware (`Sync` / `同步`), and import result summaries, the session-start migration prompt, and slash-command descriptions are in English.
- Skill frontmatter metadata and conflict reasons are in English (provenance via `metadata.source` / `metadata.kind` is preserved).

### Docs

- README rewritten in Apache-project style: badges, table of contents, plain section headers, resource links.
- Screenshots replaced with clean Docker demo captures (English UI, sample pi / codex sessions — no personal data); added a trajectory screenshot showing preserved tool-call cards.

## [0.2.2] - 2026-08-14

### Fixed

- Report a session with a missing cwd as a skip, not a failure, when attaching to workspaces.

## [0.2.1] - 2026-08-14

### Fixed

- opencode reader treats a missing database as "no sessions" instead of crashing.

## [0.2.0] - 2026-08-13

### Added

- First npm release.
- Import sessions from pi / opencode / codex / claude-code as real, resumable dsh sessions.
- Source-prefixed, pinned session titles (inherited from source titles).
- Attach imported sessions to cwd-matched workspaces (`/attach-workspaces`, CLI `--apply`).
- Agents & mode prompts converted to dsh skills with provenance metadata.
- Session-start migration prompt with per-project remembered state.
- One-click **Sync** button in the composer tool row.
- Zero runtime dependencies (Node built-ins: zstd, sqlite).
