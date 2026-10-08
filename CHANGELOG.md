# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.1] - 2026-10-08

### Fixed

- `dsh-import-agents` now writes imported sessions through the **current** harness persistence API and emits a **format-v4-legal** event log. The in-GUI import (`/import-*`, Sync button) failed with `gateway/internal: encodeCurrent requires Session format v4`; after that was fixed it could not append; and after that the log failed v4 validation on read. Eight mismatches are fixed:
  1. **Header version** — `sessionPersistence.create` must receive the current `SESSION_FORMAT_VERSION` (4) plus an explicit `isSeeded: false`; the plugin hardcoded `version: 0`, which the v4 header encoder refuses. The version is a module-local constant (manually synced to the harness's `SESSION_FORMAT_VERSION`) rather than a bare `@deepseek-ai/dsh-session` import: a bare import resolves to this repo's nested pre-release copy (`0.1.0-rc.6`, whose `SESSION_FORMAT_VERSION` is `0`) instead of the running app's bundled current version, which would keep producing `version: 0` headers and the same error.
  2. **Handle-based writes** — the persistence service no longer exposes `append(id, events)`; `create` returns a `SessionHandle`. The plugin now writes events with `handle.append(events)`, makes them durable with `handle.flush()`, and releases ownership with `handle.close()`.
  3. **`list()` snapshots** — `list()` returns `{ header, revision, … }`, so the session id lives at `snapshot.header.id` (previously `meta.id` / `meta.cwd`). Fixed in `import-service.mjs`, `migrate-on-start.mjs` and `attach-workspaces.mjs`.
  4. **Duplicate detection** — the backend now reports `session "…" already exists`, so the skip check matches `already exists` instead of the retired messages.
  5. **Tool results** — format v4 requires a `tool/result` message to be a first-class tool-role message: `role: 'tool'`, a `toolCallId` matching `source.callId`, raw result content (the released `tool-result` wrapper is rejected), and `isError`. The converter previously wrote a `role: 'user'` message wrapping a `tool-result` block, which failed with `format v4 tool/result at seq N requires a tool-role message`.
  6. **Turn/step lifecycle** — format v4 requires `step/start` … `step/end` around every assistant step inside its turn, and a turn closes only with no open step. The converter emitted only `turn/start` + `assistant/message` + `turn/end`, which failed with `assistant/message does not match an open turn and step`. `buildDshEvents` now brackets each assistant step and closes the turn through its helpers.
  7. **Bounded source reads** — every session reader, plus the header-only reads, used `readFileSync(file, 'utf8')`, which cannot materialize a transcript larger than V8's maximum string length (2^29 − 24 ≈ 512 MB characters) and throws `Cannot create a string longer than 0x1fffffe8 characters`. A 655 MB codex rollout file triggers this. The new `lib/lines.mjs` decodes one file in bounded chunks with a UTF-8 `StringDecoder` and yields lines one at a time; `pi-reader`, `codex-reader`, `claude-reader`, `plugin/import-service.mjs`, `plugin/migrate-on-start.mjs` and the CLI `import.mjs` now use `fileLines()` / `readFirstLine()`.
  8. **Batched appends** — the backend serializes a whole append batch into one string (`eventLines = events.map(eventLine).join('\n')`), so one append of a very large import exceeds the same limit. The plugin now writes events through `appendInBatches` in contiguous ~32 MB batches.

  Verified end-to-end against the running harness's persistence service, reading each written log back through the v4 lifecycle validator: two turns, two steps in one turn, a single tool call, two tool calls in one step, assistant-only, and a **655 MB** codex rollout (2185 messages → 6556 events, read back in full) all validate. A re-run reports `imported 0, skipped 1`. Covered by `tests/import-service.spec.ts`.

## [0.3.0] - 2026-08-29

### Changed

- codex import now groups rollout files into **conversations** instead of importing one session per file. Codex writes one rollout file per segment/fork of a conversation, and every file's `session_meta` chain ends at the conversation ROOT (last record, `id === session_id`); sub-agent transcripts and fork segments share the parent's root id. The import now keeps **one dsh session per root conversation** (`codex-<root-id>`), merging the messages of every file under the root with exact-duplicate folding — no more sub-agent / fork fragments as separate sessions (677 files → 348 conversations on the sample data). The reader additionally reports the conversation root alongside the file's own id. Covered by `tests/codex-reader.spec.ts`.

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
