/**
 * claude-code (Anthropic Claude Code) session reader.
 *
 * Sessions live at ~/.claude/projects/<encoded-cwd>/<session-id>.jsonl.
 * The project directory name encodes the cwd: path segments joined with `-`
 * (e.g. -Users-dongair-project-Tributo → /Users/dongair/project/Tributo).
 * Each line is an event; the conversation is carried by:
 *   user      { message: { content: string | [{type: text|tool_result, …}] } }
 *   assistant { message: { content: [{type: thinking|text|tool_use, …}] } }
 * Assistant thinking → reasoning blocks; tool_use → text markers (no results
 * are paired in a way that survives resumption); tool_result → truncated text.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** Default claude-code project root. */
export function defaultClaudeRoot() {
  return join(process.env.HOME ?? '', '.claude', 'projects')
}

/** Decode a project directory name back to the cwd path. */
export function decodeProjectDir(name) {
  const segments = name.split('-')
  if (segments.length === 0) return undefined
  // Leading dash yields a leading empty segment (root); skip it.
  const parts = segments[0] === '' ? segments.slice(1) : segments
  const path = `/${parts.join('/')}`
  return path.replace(/\/{2,}/gu, '/')
}

/** Enumerate session files across all project directories. */
export function listClaudeSessions(root) {
  const files = []
  let projects
  try {
    projects = readdirSync(root, { withFileTypes: true })
  } catch {
    return files
  }
  for (const project of projects) {
    if (!project.isDirectory()) continue
    const projectDir = join(root, project.name)
    for (const entry of readdirSync(projectDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        files.push({ file: join(projectDir, entry.name), cwd: decodeProjectDir(project.name) })
      }
    }
  }
  return files.sort((a, b) => a.file.localeCompare(b.file))
}

/** Map one assistant content block to a DSH content block (undefined = skip). */
function normalizeAssistantBlock(block) {
  switch (block?.type) {
    case 'text':
      return { type: 'text', text: block.text ?? '' }
    case 'thinking':
      return { type: 'reasoning', text: block.thinking ?? '' }
    case 'tool_use': {
      const args = block.input === undefined ? '' : JSON.stringify(block.input)
      return {
        type: 'tool-call',
        id: typeof block.id === 'string' ? block.id : `claude-call-${crypto.randomUUID()}`,
        name: String(block.name ?? 'tool'),
        arguments: args,
      }
    }
    default:
      return undefined
  }
}

/** Tool results are real output but can be huge; keep a bounded text marker. */
const TOOL_RESULT_MAX = 2000

/** Map one user content block: text passes through; tool_result becomes a marker. */
function normalizeUserBlock(block) {
  switch (block?.type) {
    case 'text':
      return { type: 'text', text: block.text ?? '' }
    case 'tool_result': {
      let content = block.content
      if (Array.isArray(content)) content = content.map(part => part.text ?? '').join('\n')
      if (typeof content !== 'string') content = JSON.stringify(content)
      const marker = content.length > TOOL_RESULT_MAX ? `${content.slice(0, TOOL_RESULT_MAX)}…` : content
      return { type: 'text', text: `[工具结果]\n${marker}` }
    }
    default:
      return undefined
  }
}

/** Normalize a message's content (string or block array) through a mapper. */
function contentBlocks(content, mapper) {
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  if (!Array.isArray(content)) return []
  const blocks = []
  for (const block of content) {
    const mapped = mapper(block)
    if (mapped !== undefined) blocks.push(mapped)
  }
  return blocks
}

/**
 * Parse one claude-code session file into normalized messages.
 * @returns { header: {id, createdAt, cwd}, messages: normalized[] }
 */
export function parseClaudeSession(file, cwd) {
  const header = { id: undefined, createdAt: undefined, cwd }
  const messages = []
  let firstTime
  for (const rawLine of readFileSync(file, 'utf8').split('\n')) {
    const line = rawLine.trim()
    if (line.length === 0) continue
    let event
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    if (header.id === undefined && typeof event.sessionId === 'string') header.id = event.sessionId
    if (event.type !== 'user' && event.type !== 'assistant') continue
    const message = event.message
    if (message === undefined || typeof message !== 'object') continue
    const role = event.type === 'user' ? 'user' : 'assistant'
    const time = event.timestamp !== undefined ? Date.parse(event.timestamp) : undefined
    if (time !== undefined && (firstTime === undefined || time < firstTime)) firstTime = time
    const blocks = role === 'user'
      ? contentBlocks(message.content, normalizeUserBlock)
      : contentBlocks(message.content, normalizeAssistantBlock)
    messages.push({
      role,
      time: time ?? firstTime ?? Date.now(),
      provider: 'claude-code',
      model: typeof event.model === 'string' ? event.model : undefined,
      blocks,
    })
  }
  if (header.id === undefined) {
    header.id = file.slice(0, -6).split('/').pop()
  }
  return { header, messages }
}
