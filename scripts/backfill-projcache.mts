/**
 * 为导入的会话回填 session_projcache.json 的投影条目。
 *
 * dsh 的会话列表显示冷会话标题时读投影缓存（session-stats 的 `title`
 * 行），而导入的会话没有投影记录（列表不探测 >1KB 的大日志）——所以
 * 只有被打开过（投影写入）或 ≤1KB 的会话有标题。本脚本用 dsh 的真实
 * backend 读取会话日志，fold 标题与基础统计后写入
 * `$DSH_HOME/storages/session_projcache.json`。
 *
 * 用法（deepseek-harness 仓库根运行；之后重启 dsh web 使缓存生效）：
 *   node --import tsx/esm ../dsh-import-agents/scripts/backfill-projcache.mts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { foldSessionTitle } from '@deepseek-ai/dsh-session-title'

const home = process.env.HOME ?? ''
const ROOT = `${home}/.dsh/sessions`
const CACHE = `${home}/.dsh/storages/session_projcache.json`

const ctx = new Context()
await ctx.plugin(SessionStore)
await ctx.plugin(JsonlSessionPersistence, { root: ROOT, compression: 'zstd' })

const headers = await ctx.sessionPersistence.list()
const imported = headers.filter(header => /^(pi|oc|codex|claude)-/u.test(header.id))

const cache = JSON.parse(readFileSync(CACHE, 'utf8'))
const sessions = cache.tables.sessions

let written = 0
for (const header of imported) {
  try {
    const { events } = await ctx.sessionPersistence.load(header.id)
    const title = foldSessionTitle(events)
    if (title === undefined) continue
    const lastSeq = events.at(-1)?.seq ?? 0
    const turns = events.filter(event => event.type === 'turn/start').length
    sessions[header.id] = {
      identity: { createdAt: header.createdAt, cwd: header.cwd },
      rows: {
        sessionStats: {
          ver: 1, seq: lastSeq,
          val: {
            turns, steps: 0, llmMs: 0, toolMs: 0, ttftMs: 0, ttftSteps: 0,
            decodeMs: 0, decodeTokens: 0, lastTurn: null, openStep: null, pendingCalls: {},
          },
        },
        title: { ver: 1, seq: lastSeq, val: title.title },
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
    console.error(`skip ${header.id}: ${error instanceof Error ? error.message : String(error)}`)
  }
}
cache.tables.sessions = sessions
writeFileSync(CACHE, JSON.stringify(cache, null, 2))
console.log(`backfilled ${written}/${imported.length} imported-session projection entries`)
