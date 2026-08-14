/**
 * Shared helpers for the pi / opencode → DSH import scripts.
 * Zero-dependency ESM, runs on Node >= 22.19 (node:sqlite + node:zlib zstd).
 */

import { homedir } from 'node:os'
import { join } from 'node:path'

/** Resolve the DSH Harness home the same way @deepseek-ai/dsh-home-paths does. */
export function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

/** Resolve the shared agents home the same way dsh-skill-filesystem does. */
export function agentsHome() {
  return process.env.DSH_AGENTS_HOME || join(homedir(), '.agents')
}

/** Log a line to stderr (stdout stays reserved for command output). */
export function log(...parts) {
  process.stderr.write(`${parts.join(' ')}\n`)
}

/** Truncate a string to `max` chars, appending an ellipsis when cut. */
export function truncate(text, max) {
  if (max === undefined || text.length <= max) return text
  return `${text.slice(0, max)}…`
}

/** Parse `--key value` style flags plus a bare positional list. */
export function parseArgs(argv, spec) {
  const flags = {}
  const positionals = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') {
      flags.help = true
      continue
    }
    if (arg === '--dry-run') { flags['dry-run'] = true; continue }
    if (arg === '--apply') { flags.apply = true; continue }
    const eq = arg.indexOf('=')
    const name = eq >= 0 ? arg.slice(0, eq) : arg
    const inline = eq >= 0 ? arg.slice(eq + 1) : undefined
    if (name.startsWith('--') && (inline !== undefined || i + 1 < argv.length && !argv[i + 1].startsWith('--'))) {
      flags[name.slice(2)] = inline ?? argv[++i]
      continue
    }
    positionals.push(arg)
  }
  for (const key of Object.keys(spec)) {
    if (flags[key] === undefined && spec[key] !== undefined) flags[key] = spec[key]
  }
  return { flags, positionals }
}

/** Parse an ISO date or epoch-ms string into ms, or undefined. */
export function parseSince(value) {
  if (value === undefined) return undefined
  const ms = Number(value)
  if (Number.isFinite(ms) && ms > 1e11) return ms
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) throw new Error(`cannot parse --since value "${value}" (use ISO date or epoch ms)`)
  return parsed
}


