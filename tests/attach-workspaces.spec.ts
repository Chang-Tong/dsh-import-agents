// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { attachSessionsToWorkspaces } from '../plugin/attach-workspaces.mjs'

const eNoent = Object.assign(
  new Error(`ENOENT: no such file or directory, realpath '/workspace/demo'`),
  { code: 'ENOENT' },
)

describe('attachSessionsToWorkspaces with a cwd missing on this machine', () => {
  it('reports a skip, not a failure, and says the session stays ungrouped', async () => {
    const ctx = {
      get: (name) => (name === 'workspaceRegistry' ? { resolveByPath: async () => { throw eNoent } } : undefined),
    }
    const lines = await attachSessionsToWorkspaces(ctx, [{ id: 'pi-x', cwd: '/workspace/demo' }])
    expect(lines[0]).toContain('[跳过] /workspace/demo')
    expect(lines[0]).toContain('未分组')
    expect(lines[0]).not.toContain('[失败]')
  })

  it('still reports a failure for non-ENOENT workspace errors', async () => {
    const ctx = {
      get: (name) => (name === 'workspaceRegistry' ? { resolveByPath: async () => { throw new Error('boom') } } : undefined),
    }
    const lines = await attachSessionsToWorkspaces(ctx, [{ id: 'pi-x', cwd: '/workspace/demo' }])
    expect(lines[0]).toContain('[失败] /workspace/demo')
    expect(lines[0]).toContain('boom')
  })
})
