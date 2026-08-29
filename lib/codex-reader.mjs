/**
 * codex (OpenAI Codex CLI) session reader.
 *
 * Sessions live at ~/.codex/sessions/<year>/<month>/<day>/rollout-*.jsonl.
 * Each line is a rollout event; the conversation is carried by:
 *   session_meta  { id, cwd, timestamp }
 *   response_item { type: 'message', role, content: [{type, text|…}] }
 *   event_msg     { type: 'user_message', message }
 * response_item user messages repeat the same text as the user_message event,
 * so consecutive duplicates are collapsed. System-injected text blocks
 * (<environment_context>, <permissions instructions>, <turn_aborted> …) are
 * skipped.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** Default codex session root. */
export function defaultCodexRoot() {
  return join(process.env.HOME ?? '', '.codex', 'sessions')
}

/** Enumerate rollout files under the date-based directory tree. */
export function listCodexSessions(root) {
  const files = []
  const walk = (dir) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile() && entry.name.endsWith('.jsonl') && entry.name.startsWith('rollout-')) files.push(path)
    }
  }
  walk(root)
  return files.sort()
}

/** System-injected text blocks codex puts into user content; never conversation. */
const SYSTEM_BLOCK = /^<(environment_context|permissions instructions|turn_aborted|request_id|model|end_of_conversation|turn_id)>/u

/** Map one response_item content block to a DSH content block (undefined = skip). */
function normalizeContentBlock(block) {
  switch (block?.type) {
    case 'input_text':
    case 'output_text': {
      const text = block.text ?? ''
      if (SYSTEM_BLOCK.test(text.trim())) return undefined
      return { type: 'text', text }
    }
    case 'reasoning':
      return { type: 'reasoning', text: block.summary ?? block.text ?? '' }
    case 'tool_use': {
      const args = block.input === undefined ? '' : JSON.stringify(block.input)
      return {
        type: 'tool-call',
        id: typeof block.id === 'string' ? block.id : `codex-call-${crypto.randomUUID()}`,
        name: String(block.name ?? 'tool'),
        arguments: args,
      }
    }
    default:
      return undefined
  }
}

/**
 * Parse one codex rollout file into normalized messages.
 * @returns {
 *   header: {id, createdAt, cwd}, — this file's own session id (first session_meta)
 *   root: {id, createdAt, cwd},   — the conversation root (last session_meta chain record)
 *   messages: normalized[],
 * }
 */
export function parseCodexSession(file) {
  const header = { id: undefined, createdAt: undefined, cwd: undefined }
  let rootPayload
  const messages = []
  let lastUserText
  for (const rawLine of readFileSync(file, 'utf8').split('\n')) {
    const line = rawLine.trim()
    if (line.length === 0) continue
    let event
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    if (event.type === 'session_meta') {
      const payload = event.payload ?? {}
      // Codex writes the session lineage into later session_meta events (a
      // forked or resumed conversation lists its parent ids); the FIRST one is
      // this file's own session id (matches the filename uuid), the LAST one
      // is the conversation ROOT (id === session_id). Keep both.
      if (header.id === undefined) {
        header.id = payload.id
        header.cwd = payload.cwd
        const created = Date.parse(payload.timestamp)
        header.createdAt = Number.isNaN(created) ? undefined : created
      }
      rootPayload = payload
      continue
    }
    if (event.type !== 'response_item') continue
    const payload = event.payload ?? {}
    if (payload.type !== 'message') continue
    const role = payload.role
    if (role !== 'user' && role !== 'assistant') continue
    const blocks = []
    for (const block of Array.isArray(payload.content) ? payload.content : []) {
      const mapped = normalizeContentBlock(block)
      if (mapped !== undefined) blocks.push(mapped)
    }
    if (role === 'user') {
      // The same prompt is echoed per turn; collapse consecutive duplicates.
      const text = blocks.filter(block => block.type === 'text').map(block => block.text).join('\n')
      if (text === lastUserText && blocks.every(block => block.type === 'text')) continue
      lastUserText = text
    }
    if (blocks.length === 0) continue
    messages.push({ role, time: Date.parse(event.timestamp), provider: 'codex', model: undefined, blocks })
  }
  const rootCreated = rootPayload?.timestamp === undefined
    ? undefined
    : Number.isNaN(Date.parse(rootPayload.timestamp)) ? undefined : Date.parse(rootPayload.timestamp)
  return {
    header,
    root: {
      id: rootPayload?.id ?? header.id,
      cwd: rootPayload?.cwd ?? header.cwd,
      createdAt: rootCreated ?? header.createdAt,
    },
    messages,
  }
}

/** Structural dedupe key: role plus every block projected to stable text. */
function messageKey(message) {
  const blocks = (message.blocks ?? []).map((block) => {
    switch (block.type) {
      case 'text': return `t:${block.text}`
      case 'reasoning': return `r:${block.text}`
      case 'tool-call': return `c:${block.name}:${block.arguments}`
      default: return `o:${JSON.stringify(block)}`
    }
  })
  return `${message.role}\u0000${blocks.join('\u0001')}`
}

/**
 * Group codex rollout files into conversations. Codex writes one rollout file
 * per segment/fork of a conversation, and every file's `session_meta` chain
 * ends at the conversation ROOT (the last record, whose `id === session_id`).
 * Sub-agent transcripts and fork segments therefore share their parent's root
 * id. Grouping by root keeps ONE dsh session per conversation: messages of all
 * files under the root are merged, exact duplicates (cumulative segments) are
 * dropped, and no segment becomes a separate session.
 * @param root - the codex sessions dir (~/.codex/sessions).
 * @returns { header, messages, files }[] one per root conversation, newest
 *   conversation first (by the root's own createdAt).
 */
export function listCodexConversations(codexRoot) {
  const groups = new Map()
  for (const file of listCodexSessions(codexRoot)) {
    const parsed = parseCodexSession(file)
    if (parsed.root.id === undefined) continue
    let group = groups.get(parsed.root.id)
    if (group === undefined) {
      group = {
        header: { id: parsed.root.id, createdAt: parsed.root.createdAt, cwd: parsed.root.cwd },
        messages: [],
        files: 0,
        seen: new Set(),
      }
      groups.set(parsed.root.id, group)
    }
    group.files += 1
    for (const message of parsed.messages) {
      const key = messageKey(message)
      if (group.seen.has(key)) continue
      group.seen.add(key)
      group.messages.push(message)
    }
  }
  const conversations = [...groups.values()].map(({ header, messages, files }) => ({ header, messages, files }))
  conversations.sort((a, b) => (b.header.createdAt ?? 0) - (a.header.createdAt ?? 0))
  return conversations
}
