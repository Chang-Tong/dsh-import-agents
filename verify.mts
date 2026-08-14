/**
 * 回归验证：用 dsh 自己的后端读回导入产物。
 *
 * 在 deepseek-harness 仓库根运行（tsx 需要仓库的 tsconfig paths 才能解析
 * @deepseek-ai/* 工作区包）：
 *
 *   node --import tsx/esm ../import-pi-opencode/verify.mts \
 *     /tmp/check/sessions /tmp/check/skills
 *
 * 参数 1: 会话根（import.mjs --sessions-root 的产物）
 * 参数 2: 技能根（import.mjs --skills-root 的产物）
 */
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem'

const sessionsRoot = process.argv[2] ?? '/tmp/dsh-import-test/sessions'
const skillsRoot = process.argv[3] ?? '/tmp/dsh-import-test/skills'

// --- sessions: real JSONL backend reads every staged artifact ---
const ctx = new Context()
await ctx.plugin(SessionStore)
await ctx.plugin(JsonlSessionPersistence, { root: sessionsRoot, compression: 'zstd' })

const headers = await ctx.sessionPersistence.list()
console.log(`backend lists ${headers.length} sessions`)
let failures = 0
for (const header of headers) {
  try {
    const { meta, events } = await ctx.sessionPersistence.load(header.id)
    const prep = await ctx.sessionPersistence.prepare(header.id)
    console.log(`OK  ${header.id}  events=${events.length}  cwd=${meta.cwd ?? '(none)'}  prepared=${prep.session !== undefined}`)
    prep.dispose?.()
  } catch (error) {
    failures += 1
    console.log(`FAIL ${header.id}: ${error.message}`)
  }
}
console.log(failures === 0 ? 'SESSIONS ALL PASS' : `${failures} SESSION FAILURES`)
if (failures !== 0) process.exit(1)

// --- skills: real filesystem provider discovers every staged skill ---
const skillCtx = new Context()
await skillCtx.plugin(SkillRegistry)
await skillCtx.plugin(SkillFileSystem, {
  includeDefaultRoots: false,
  customSkillDirs: [skillsRoot],
  watch: false,
  bundledSkillDir: undefined,
})
const skills = await skillCtx.skills.list()
console.log(`skill provider lists ${skills.length} skills: ${skills.map(skill => skill.name).join(', ')}`)
for (const skill of skills) {
  console.log(`OK  skill ${skill.name}: ${skill.description?.slice(0, 60) ?? '(no description)'}`)
}
console.log('SKILLS ALL PASS')
