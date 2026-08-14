#!/usr/bin/env node
/**
 * 构建 dsh client bundle：esbuild 打包 src/client → lib/client.js。
 *
 * 产物遵循 dsh 的 client bundle 协议：
 *   window.__ModuleLoader__.load({ id, factory: (require) => {...} })
 * 外部依赖（react、@deepseek-ai/*）通过 factory 的 require 参数注入，
 * 由 dsh web 的模块表提供，不打进 bundle。
 */

import { build } from 'esbuild'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGE_ID = 'dsh-import-pi-opencode'
const OUT_DIR = join(ROOT, '.build')
const LIB_DIR = join(ROOT, 'lib')

mkdirSync(OUT_DIR, { recursive: true })
mkdirSync(LIB_DIR, { recursive: true })

await build({
  entryPoints: [join(ROOT, 'src/client/index.ts')],
  bundle: true,
  format: 'iife',
  globalName: '__dshImportClientFactory',
  platform: 'browser',
  target: ['es2020'],
  // 平台模块（dsh 的 __ModuleLoader__ 模块表提供），不打进 bundle。
  external: ['react', 'react/jsx-runtime'],
  jsx: 'automatic',
  outfile: join(OUT_DIR, 'factory.js'),
  sourcemap: true,
  logLevel: 'info',
})

const inner = readFileSync(join(OUT_DIR, 'factory.js'), 'utf8')
writeFileSync(join(LIB_DIR, 'client.js'), `window.__ModuleLoader__.load({
  id: ${JSON.stringify(PACKAGE_ID)},
  factory: (require) => {
${inner}
    return __dshImportClientFactory;
  },
});
//# sourceMappingURL=client.js.map
`)
writeFileSync(join(LIB_DIR, 'client.js.map'), readFileSync(join(OUT_DIR, 'factory.js.map'), 'utf8'))
console.log(`built ${join(LIB_DIR, 'client.js')}`)
