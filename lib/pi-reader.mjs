/**
 * pi (pi-coding-agent) session reader.
 *
 * pi stores one JSONL file per session under
 *   ~/.pi/agent/sessions/<project-dir-key>/<timestamp>_<uuid>.jsonl
 * Each line is an event: `session` (header), `model_change`, `message`.
 * Message content blocks: text / thinking / toolCall / image.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** Default pi session store root. */
export function defaultPiRoot() {
  return join(process.env.HOME ?? '', '.pi', 'agent', 'sessions')
}

/** Enumerate session files across all project directories. */
export function listPiSessions(root) {
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
        files.push(join(projectDir, entry.name))
      }
    }
  }
  return files.sort()
}

/**
 * Parse one pi session file into normalized messages.
 * @returns { header: {id, createdAt, cwd}, messages: normalized[] }
 */
export function parsePiSession(file) {
  const header = { id: undefined, createdAt: undefined, cwd: undefined }
  const messages = []
  let provider
  let model
  for (const rawLine of readFileSync(file, 'utf8').split('\n')) {
    const line = rawLine.trim()
    if (line.length === 0) continue
    let event
    try {
      event = JSON.parse(line)
    } catch {
      continue // torn tail or foreign line: skip, never abort the import
    }
    if (event.type === 'session') {
      header.id = event.id
      header.cwd = event.cwd
      const created = Date.parse(event.timestamp)
      header.createdAt = Number.isNaN(created) ? undefined : created
    } else if (event.type === 'model_change') {
      if (typeof event.provider === 'string') provider = event.provider
      if (typeof event.modelId === 'string') model = event.modelId
    } else if (event.type === 'message' && event.message && typeof event.message === 'object') {
      const role = event.message.role
      if (role !== 'user' && role !== 'assistant') continue
      const time = typeof event.message.timestamp === 'number'
        ? event.message.timestamp
        : Date.parse(event.timestamp)
      const blocks = []
      for (const block of Array.isArray(event.message.content) ? event.message.content : []) {
        const mapped = normalizeBlock(block)
        if (mapped !== undefined) blocks.push(mapped)
      }
      messages.push({ role, time, provider, model, blocks })
    }
  }
  return { header, messages }
}

/** Map one pi content block to a DSH content block. */
function normalizeBlock(block) {
  switch (block?.type) {
    case 'text':
      return { type: 'text', text: block.text ?? '' }
    case 'thinking':
      return { type: 'reasoning', text: block.thinking ?? '' }
    case 'toolCall': {
      const args = block.arguments === undefined ? '' : JSON.stringify(block.arguments)
      return {
        type: 'tool-call',
        id: typeof block.id === 'string' ? block.id : `pi-call-${crypto.randomUUID()}`,
        name: String(block.name ?? 'tool'),
        arguments: args,
      }
    }
    case 'image':
      return { type: 'text', text: '[图片已省略]' }
    default:
      return undefined
  }
}
