/**
 * opencode session reader (SQLite).
 *
 * opencode stores sessions in ~/.local/share/opencode/opencode.db:
 *   session(id, directory, time_created, …)
 *   message(id, session_id, time_created, data)      data has {role, model, …}
 *   part(message_id, session_id, time_created, data) data has {type, …}
 * Message text lives in parts, never in message.data.
 */

import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'

/** Default opencode data root. */
export function defaultOpencodeDb() {
  return join(process.env.HOME ?? '', '.local', 'share', 'opencode', 'opencode.db')
}

/** Enumerate session rows. */
export function listOpencodeSessions(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    return db.prepare(
      'SELECT id, directory, time_created, title FROM session ORDER BY time_created',
    ).all()
  } finally {
    db.close()
  }
}

/**
 * Load one session's messages with their parts attached.
 * @returns normalized messages in chronological order.
 */
export function readOpencodeSession(dbPath, sessionId) {
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    const messages = db.prepare(
      'SELECT id, time_created, data FROM message WHERE session_id = ? ORDER BY time_created, id',
    ).all(sessionId)
    const partsByMessage = new Map()
    for (const part of db.prepare(
      'SELECT message_id, data FROM part WHERE session_id = ? ORDER BY time_created, id',
    ).all(sessionId)) {
      let list = partsByMessage.get(part.message_id)
      if (list === undefined) {
        list = []
        partsByMessage.set(part.message_id, list)
      }
      try {
        const data = typeof part.data === 'string' ? JSON.parse(part.data) : part.data
        if (data !== null && typeof data === 'object') list.push(data)
      } catch {
        // A single unparseable part must not sink the whole session.
      }
    }
    const normalized = []
    for (const message of messages) {
      const data = typeof message.data === 'string' ? JSON.parse(message.data) : message.data
      const role = data.role
      if (role !== 'user' && role !== 'assistant') continue
      const provider = data.model?.providerID
      const model = data.model?.modelID
      const time = data.time?.created ?? message.time_created
      const blocks = []
      for (const part of partsByMessage.get(message.id) ?? []) {
        const mapped = normalizePart(part)
        if (mapped !== undefined) blocks.push(mapped)
      }
      normalized.push({ role, time, provider, model, blocks })
    }
    return normalized
  } finally {
    db.close()
  }
}

/** Map one opencode part to a DSH content block (undefined = skip). */
function normalizePart(part) {
  switch (part?.type) {
    case 'text':
      return { type: 'text', text: part.text ?? '' }
    case 'reasoning':
      return { type: 'reasoning', text: part.text ?? '' }
    case 'tool': {
      const input = part.state?.input ?? {}
      const args = JSON.stringify(input)
      return {
        type: 'tool-call',
        id: typeof part.callID === 'string' ? part.callID : `oc-call-${crypto.randomUUID()}`,
        name: String(part.tool ?? 'tool'),
        arguments: args,
      }
    }
    case 'step-start':
    case 'step-finish':
    case 'compaction':
    case 'file':
    case 'patch':
      return undefined // mechanical records, not conversation
    default:
      return undefined
  }
}
