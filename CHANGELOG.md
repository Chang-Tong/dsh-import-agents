# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.8] - 2026-08-25

### Fixed

- codex import now attributes each rollout file to its **own** session id. Newer codex formats write a session lineage into multiple `session_meta` events (a forked/resumed conversation lists its parent ids), and the reader was using the **last** one — folding the newest sessions into an already-imported parent id and skipping them as "existing", so the latest codex conversations never appeared. The reader now keeps the **first** `session_meta` (which matches the filename uuid). Covered by `tests/codex-reader.spec.ts`.
- `scripts/backfill-projcache.mjs` now decodes **all** zstd frames of a session log instead of only the first, so it can fold titles/stats from dsh's own multi-frame artifacts. Previously it saw only the header frame, found no title, and skipped most imported sessions — leaving the session list (which reads the projection cache) without those sessions or their titles.

## [0.2.7] - 2026-08-21

### Fixed

- Sync button now calls `commands.execute` with the required three business arguments `(sessionId, line, images)`; previously the missing `images` argument made dsh reject the call with `expected 3 business argument(s) plus an optional AbortSignal, got 2`, so the button always failed. Added a wiring regression test (`tests/sync-wiring.spec.ts`) that would have caught this.
- `/import-all` (and the per-source commands) no longer fail with `session "…" already exists in this backend` on re-runs: the backend registers a session in memory on `create` and only materializes it on the batched `append` (~200 ms window), so a quick re-run — or a migration prompt racing the Sync button — could hit an in-memory duplicate that `list()` had not yet returned. Such rejections (and the on-disk "already has a persisted log" variant) are now counted as skips, and duplicate candidate ids from multi-file sources (e.g. one codex rollout file per turn) are imported once. Covered by `tests/import-service.spec.ts`.

## [0.2.6] - 2026-08-17

### Docs

- Installation section now keeps only the official one-command flow (`dsh plugin --profile web add dsh-import-agents`, verified to auto-activate the `dsh.bundle` layer); the manual `pnpm add` + `cordis.patch.yml` alternative was removed as unnecessary.

## [0.2.5] - 2026-08-17

### Changed

- CLI `all` command now imports **all four sources** (pi / opencode / codex / claude-code) plus agents — identical to the in-GUI `/import-all`, so the two "all" entry points have the same semantics.

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
