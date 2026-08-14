/**
 * Conversation → DSH session-log conversion.
 *
 * Both source readers normalize to one message shape:
 *   { role: 'user'|'assistant', time: ms, provider?, model?, blocks: [...] }
 * where blocks are already mapped to DSH content blocks
 * (text / reasoning / tool-call). This module folds the message stream into a
 * balanced DSH event log: each user message opens a turn (turn/start +
 * user/message), following assistant messages join it with an increasing step
 * (assistant/message), and the turn closes with turn/end {kind:'completed'}.
 */

/** Fold normalized messages into a balanced DSH event list (seq 0..n-1). */
export function buildDshEvents(messages) {
  const events = []
  let turn = 0
  let step = 0
  let openTurn = false
  let lastTime = 0

  /** Non-decreasing timestamps keep the log well-formed for replay. */
  const atLeast = (time) => {
    if (time > lastTime) lastTime = time
    return lastTime
  }

  const push = (type, time, data, surfaceOp) => {
    events.push({ type, time: atLeast(time), data, ...(surfaceOp ? { surfaceOp } : {}) })
  }

  for (const message of messages) {
    if (message.role === 'user') {
      if (openTurn) {
        push('turn/end', message.time, { turn, reason: { kind: 'completed' } })
        openTurn = false
      }
      turn += 1
      step = 0
      openTurn = true
      push('turn/start', message.time, { turn })
      if (message.blocks.length > 0) {
        push('user/message', message.time, {
          role: 'user',
          source: { kind: 'user' },
          content: message.blocks,
          id: randomId(),
        }, 'append')
      }
    } else {
      if (!openTurn) {
        turn += 1
        step = 0
        openTurn = true
        push('turn/start', message.time, { turn })
      }
      if (message.blocks.length === 0) continue
      step += 1
      push('assistant/message', message.time, {
        turn,
        step,
        message: {
          role: 'assistant',
          source: { kind: 'model', provider: message.provider ?? 'imported', model: message.model ?? 'unknown' },
          content: message.blocks,
          id: randomId(),
        },
      }, 'append')
    }
  }
  if (openTurn) {
    push('turn/end', lastTime, { turn, reason: { kind: 'completed' } })
  }
  return events
}

/** Fresh stable message identity (DSH MessageId is a branded uuid string). */
function randomId() {
  return crypto.randomUUID()
}
