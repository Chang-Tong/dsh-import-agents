/**
 * 为导入的会话回填 session_projcache.json 的投影条目。
 *
 * dsh 的会话列表显示冷会话标题时读投影缓存（session-stats 的 `title`
 * 行），而导入的会话没有投影记录（列表不探测 >1KB 的大日志）——所以
 * 只有被打开过（投影写入）或 ≤1KB 的会话有标题。本脚本从会话日志
 * fold 标题与基础统计，写入 `$DSH_HOME/storages/session_projcache.json`。
 *
 * 用法（deepseek-harness 仓库根运行；之后重启 dsh web 使缓存生效）：
 *   node --import tsx/esm ../dsh-import-agents/scripts/backfill-projcache.mjs
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

const home = process.env.HOME ?? ''
const ROOT = `${home}/.dsh/sessions`
const CACHE = `${home}/.dsh/storages/session_projcache.json`
const PREFIXES = /^(pi|oc|codex|claude)-/u

/** 解压一个会话日志；返回 {header, events}。 */
function readLog(logPath) {
  const text = zstdDecompressSync(readFileSync(logPath)).toString('utf8')
  const events = []
  let header
  let seenHeader = false
  for (const line of text.split('\n')) {
    if (line.trim().length === 0) continue
    try {
      const event = JSON.parse(line)
      if (!seenHeader && event.type === 'session') {
        header = event
        seenHeader = true
      }
      events.push(event)
    } catch {
      // torn tail: ignore
    }
  }
  return { header, events }
}

/** 从事件 fold 标题与统计。 */
function fold(events) {
  let title
  let turns = 0
  let lastSeq = 0
  for (const event of events) {
    if (event.seq > lastSeq) lastSeq = event.seq
    if (event.type === 'turn/start') turns += 1
    if (event.type === 'session/title') title = event.data.title
  }
  return { title, turns, lastSeq }
}

const cache = JSON.parse(readFileSync(CACHE, 'utf8'))
const sessions = cache.tables.sessions

let written = 0
for (const projectDir of readdirSync(ROOT, { withFileTypes: true })) {
  if (!projectDir.isDirectory()) continue
  for (const entry of readdirSync(join(ROOT, projectDir.name), { withFileTypes: true })) {
    if (!entry.isDirectory() || !PREFIXES.test(entry.name)) continue
    const logPath = join(ROOT, projectDir.name, entry.name, 'session.jsonl.zstd')
    if (!existsSync(logPath)) continue
    try {
      const { header, events } = readLog(logPath)
      const { title, turns, lastSeq } = fold(events)
      if (title === undefined) continue
      sessions[entry.name] = {
        identity: { createdAt: header?.createdAt, cwd: header?.cwd },
        rows: {
          sessionStats: {
            ver: 1, seq: lastSeq,
            val: {
              turns, steps: 0, llmMs: 0, toolMs: 0, ttftMs: 0, ttftSteps: 0,
              decodeMs: 0, decodeTokens: 0, lastTurn: null, openStep: null, pendingCalls: {},
            },
          },
          title: { ver: 1, seq: lastSeq, val: title },
          goal: { ver: 4, seq: lastSeq, val: null },
          tokenUsage: {
            ver: 1, seq: lastSeq,
            val: {
              totals: { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
              last: null,
            },
          },
          contextPressure: { ver: 4, seq: lastSeq, val: { surfaceTokens: 0 } },
          contextBreakdown: { ver: 2, seq: lastSeq, val: { systemTokens: 0, toolsTokens: 0, messageTokens: 0 } },
          subagentTiming: { ver: 2, seq: lastSeq, val: { descriptorSeen: false, settledMs: 0 } },
          subagent: { ver: 2, seq: lastSeq, val: {} },
        },
      }
      written += 1
    } catch (error) {
      console.error(`skip ${entry.name}: ${error.message}`)
    }
  }
}
cache.tables.sessions = sessions
writeFileSync(CACHE, JSON.stringify(cache, null, 2))
console.log(`backfilled ${written} imported-session projection entries`)
