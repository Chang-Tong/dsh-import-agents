/**
 * importSessions 幂等性测试：后端已存在的会话（内存态或磁盘产物）必须按跳过
 * 处理，而不是让整个 /import-all 失败；同一 id 的多个候选只导入一次。
 * reader 全部 mock，避免触碰真实用户数据。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

const PERSISTENCE = (create, append) => ({
  list: async () => [],
  create,
  append,
  ctx: undefined,
})

const MESSAGES = [{ role: 'user', time: 1, blocks: [{ type: 'text', text: 'hi' }] }]

beforeEach(() => {
  readerState.rows = []
  readerState.messages = []
})

describe('importSessions idempotency', () => {
  it('treats a backend "already exists" rejection as a skip', async () => {
    readerState.rows = [{ id: 'ses_x', directory: '/proj', time_created: 1 }]
    readerState.messages = MESSAGES
    const append = vi.fn()
    const lines = await importSessions(
      PERSISTENCE(vi.fn().mockRejectedValue(new Error('session "oc-x" already exists in this backend')), append),
      'opencode',
      {},
    )
    expect(append).not.toHaveBeenCalled()
    expect(lines.join('\n')).toContain('skipped 1')
  })

  it('treats a persisted-log-on-disk rejection as a skip', async () => {
    readerState.rows = [{ id: 'ses_y', directory: '/proj', time_created: 1 }]
    readerState.messages = MESSAGES
    const append = vi.fn()
    const lines = await importSessions(
      PERSISTENCE(vi.fn().mockRejectedValue(new Error('session "oc-y" already has a persisted log on disk; load/resume it instead of creating')), append),
      'opencode',
      {},
    )
    expect(append).not.toHaveBeenCalled()
    expect(lines.join('\n')).toContain('skipped 1')
  })

  it('rethrows rejections that are not duplicate-session errors', async () => {
    readerState.rows = [{ id: 'ses_z', directory: '/proj', time_created: 1 }]
    readerState.messages = MESSAGES
    const create = vi.fn().mockRejectedValue(new Error('session metadata createdAt must be a non-negative safe integer'))
    await expect(importSessions(PERSISTENCE(create, vi.fn()), 'opencode', {})).rejects.toThrow(
      'session metadata createdAt must be a non-negative safe integer',
    )
  })

  it('imports a duplicate candidate id only once', async () => {
    readerState.rows = [
      { id: 'ses_dup', directory: '/proj', time_created: 1 },
      { id: 'ses_dup', directory: '/proj', time_created: 1 },
    ]
    readerState.messages = MESSAGES
    const create = vi.fn().mockResolvedValue(undefined)
    const append = vi.fn().mockResolvedValue(undefined)
    const lines = await importSessions(PERSISTENCE(create, append), 'opencode', {})
    expect(create).toHaveBeenCalledTimes(1)
    expect(append).toHaveBeenCalledTimes(1)
    expect(lines.join('\n')).toContain('imported 1')
  })

  it('skips sessions already listed by the backend', async () => {
    readerState.rows = [{ id: 'ses_old', directory: '/proj', time_created: 1 }]
    readerState.messages = MESSAGES
    const create = vi.fn()
    const append = vi.fn()
    const lines = await importSessions(
      { list: async () => [{ id: 'oc-old' }], create, append, ctx: undefined },
      'opencode',
      {},
    )
    expect(create).not.toHaveBeenCalled()
    expect(append).not.toHaveBeenCalled()
    expect(lines.join('\n')).toContain('skipped 1')
  })
})
