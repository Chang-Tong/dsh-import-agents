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
 *
 * With `toolEvents: true` (the default for imports), an assistant message's
 * tool-call blocks additionally emit paired `tool/call` + `tool/result`
 * events: `tool/call` drives the trajectory UI, and the placeholder
 * `tool/result` keeps resumed model requests API-legal (every `tool_calls`
 * answered by a `tool` message, as OpenAI-compatible providers require).
 * The tool-call block stays in the assistant content so the call itself is
 * model-visible.
 */

/** Placeholder text for tool results the source tool never recorded. */
export const TOOL_RESULT_PLACEHOLDER = '[工具结果未记录：源工具不保存调用结果，仅保留调用信息]'

/**
 * Fold normalized messages into a balanced DSH event list (seq 0..n-1).
 * @param messages - normalized message stream in chronological order.
 * @param options.toolEvents - emit paired tool/call + tool/result events for
 *   tool-call blocks (default false; importers enable it).
 * @returns the balanced event list.
 */
export function buildDshEvents(messages, options = {}) {
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
      if (options.toolEvents === true) {
        for (const block of message.blocks) {
          if (block.type !== 'tool-call') continue
          // tool/call is log-only: trajectory UI reads it, model requests do not.
          push('tool/call', message.time, {
            turn,
            step,
            callId: block.id,
            name: block.name,
            arguments: block.arguments,
          })
          // tool/result is surface: it derives the user-role tool message that
          // answers the assistant's tool_calls in resumed requests.
          push('tool/result', message.time, {
            turn,
            step,
            message: {
              role: 'user',
              source: { kind: 'tool', callId: block.id },
              content: [{
                type: 'tool-result',
                toolCallId: block.id,
                content: [{ type: 'text', text: TOOL_RESULT_PLACEHOLDER }],
                isError: false,
              }],
              id: randomId(),
            },
          }, 'append')
        }
      }
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
