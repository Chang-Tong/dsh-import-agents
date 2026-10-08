/**
 * importSessions 幂等性测试：后端已存在的会话（内存态或磁盘产物）必须按跳过
 * 处理，而不是让整个 /import-all 失败；同一 id 的多个候选只导入一次。
 * reader 全部 mock，避免触碰真实用户数据。
 *
 * 当前持久化服务是 handle 制：create() 返回独占写句柄，事件经 handle.append
 * 写入；list() 返回 { header, revision, ... } 快照（id 在 header 里）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SESSION_FORMAT_VERSION } from '../plugin/import-service.mjs'

const { readerState } = vi.hoisted(() => ({
  readerState: {
    rows: [] as Array<{ id: string; directory: string; time_created: number }>,
    messages: [] as unknown[],
  },
}))

vi.mock('../lib/opencode-reader.mjs', () => ({
  listOpencodeSessions: () => readerState.rows,
  readOpencodeSession: () => readerState.messages,
}))
vi.mock('../lib/pi-reader.mjs', () => ({
  listPiSessions: () => [],
  parsePiSession: () => ({ header: {}, messages: [] }),
}))
vi.mock('../lib/codex-reader.mjs', () => ({
  listCodexSessions: () => [],
  parseCodexSession: () => ({ header: {}, messages: [] }),
}))
vi.mock('../lib/claude-reader.mjs', () => ({
  listClaudeSessions: () => [],
  parseClaudeSession: () => ({ header: {}, messages: [] }),
}))

import { importSessions } from '../plugin/import-service.mjs'

/** Mock 一个 handle 制的持久化服务：create 返回写句柄，list 返回 header 快照。 */
const HANDLE = () => ({
  append: vi.fn().mockResolvedValue(undefined),
  flush: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
})
const PERSISTENCE = (create, list = async () => []) => ({ list, create, ctx: undefined })

const MESSAGES = [{ role: 'user', time: 1, blocks: [{ type: 'text', text: 'hi' }] }]

beforeEach(() => {
  readerState.rows = []
  readerState.messages = []
})

describe('importSessions idempotency', () => {
  it('treats a backend "already exists" rejection as a skip', async () => {
    readerState.rows = [{ id: 'ses_x', directory: '/proj', time_created: 1 }]
    readerState.messages = MESSAGES
    const lines = await importSessions(
      PERSISTENCE(vi.fn().mockRejectedValue(new Error('session "oc-x" already exists'))),
      'opencode',
      {},
    )
    expect(lines.join('\n')).toContain('skipped 1')
  })

  it('treats a persisted-log-on-disk rejection as a skip', async () => {
    readerState.rows = [{ id: 'ses_y', directory: '/proj', time_created: 1 }]
    readerState.messages = MESSAGES
    const lines = await importSessions(
      PERSISTENCE(vi.fn().mockRejectedValue(new Error('refusing to materialize "oc-y": a log already exists on disk (open it instead)'))),
      'opencode',
      {},
    )
    expect(lines.join('\n')).toContain('skipped 1')
  })

  it('rethrows rejections that are not duplicate-session errors', async () => {
    readerState.rows = [{ id: 'ses_z', directory: '/proj', time_created: 1 }]
    readerState.messages = MESSAGES
    const create = vi.fn().mockRejectedValue(new Error('session metadata createdAt must be a non-negative safe integer'))
    await expect(importSessions(PERSISTENCE(create), 'opencode', {})).rejects.toThrow(
      'session metadata createdAt must be a non-negative safe integer',
    )
  })

  it('imports a duplicate candidate id only once', async () => {
    readerState.rows = [
      { id: 'ses_dup', directory: '/proj', time_created: 1 },
      { id: 'ses_dup', directory: '/proj', time_created: 1 },
    ]
    readerState.messages = MESSAGES
    const handle = HANDLE()
    const create = vi.fn().mockResolvedValue(handle)
    const lines = await importSessions(PERSISTENCE(create), 'opencode', {})
    expect(create).toHaveBeenCalledTimes(1)
    // 头必须是当前格式版本 + 显式 isSeeded——旧代码硬编码 version:0 让
    // 运行中的 gateway 在 encodeCurrent 处拒绝（"requires Session format v4"）。
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      version: SESSION_FORMAT_VERSION,
      isSeeded: false,
    }))
    // 事件必须经 create 返回的写句柄写入（服务本身没有 append(id, events)）。
    expect(handle.append).toHaveBeenCalledTimes(1)
    expect(handle.flush).toHaveBeenCalledTimes(1)
    expect(handle.close).toHaveBeenCalledTimes(1)
    expect(lines.join('\n')).toContain('imported 1')
  })

  it('skips sessions already listed by the backend', async () => {
    readerState.rows = [{ id: 'ses_old', directory: '/proj', time_created: 1 }]
    readerState.messages = MESSAGES
    const handle = HANDLE()
    const create = vi.fn().mockResolvedValue(handle)
    const lines = await importSessions(
      PERSISTENCE(create, async () => [{ header: { id: 'oc-old' } }]),
      'opencode',
      {},
    )
    expect(create).not.toHaveBeenCalled()
    expect(handle.append).not.toHaveBeenCalled()
    expect(lines.join('\n')).toContain('skipped 1')
  })
})
