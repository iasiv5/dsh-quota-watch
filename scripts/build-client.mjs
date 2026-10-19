import { mkdir, writeFile } from 'node:fs/promises'
import esbuild from 'esbuild'

const result = await esbuild.build({
  entryPoints: ['src/client.mjs'],
  bundle: true,
  platform: 'browser',
  format: 'cjs',
  target: 'es2022',
  write: false,
  minify: false,
  // React is provided by the host client bundle: the module-loader factory
  // passes `require` through, so keeping react external defers resolution to
  // runtime instead of failing on a build-time copy.
  external: ['react'],
})

const body = result.outputFiles[0].text
const output = 'window.__ModuleLoader__.load({\n'
  + '\tid: "@iasiv5/dsh-quota-watch",\n'
  + '\tfactory: (require) => {\n'
  + '\t\tvar module = { exports: {} };\n'
  + '\t\tvar exports = module.exports;\n'
  + '\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });\n'
  + body + '\n'
  + '\t\treturn module.exports;\n'
  + '\t}\n'
  + '});\n'

await mkdir('lib', { recursive: true })
await writeFile('lib/client.js', output, 'utf8')
console.log('wrote lib/client.js')
