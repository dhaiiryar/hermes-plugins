import { build } from 'esbuild'
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import path from 'node:path'
import { sourceFingerprint } from './evidence.mjs'

const root = process.cwd(), out = path.join(root, 'dist')
await mkdir(out, { recursive: true })
const packageRoot = path.join(root, 'node_modules/@excalidraw/excalidraw'), prod = path.join(packageRoot, 'dist/prod')
const assets = {}, omitted = []
async function fonts(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const filename = path.join(dir, entry.name)
    if (entry.isDirectory()) await fonts(filename)
    else if (entry.name.endsWith('.woff2')) {
      const key = './' + path.relative(prod, filename)
      if (key.includes('/Xiaolai/')) omitted.push(key)
      else assets[key] = `data:font/woff2;base64,${(await readFile(filename)).toString('base64')}`
    }
  }
}
await fonts(path.join(prod, 'fonts'))
const fallback = './fonts/Liberation/LiberationSans-Regular.woff2'
const plugin = { name: 'offline-editor', setup(b) {
  b.onResolve({ filter: /^@excalidraw\/mermaid-to-excalidraw$/ }, () => ({ path: 'mermaid', namespace: 'offline' }))
  b.onLoad({ filter: /.*/, namespace: 'offline' }, () => ({ contents: 'export async function parseMermaidToExcalidraw(){throw new Error("Mermaid conversion is disabled in local-only mode.")}', loader: 'js' }))
  b.onLoad({ filter: /@excalidraw\/excalidraw\/dist\/prod\/.*\.js$/ }, async args => {
    let contents = await readFile(args.path, 'utf8')
    contents = contents.replace(/(["'])(\.\/fonts\/[^"']+\.woff2)\1/g, (_, quote, key) => `window.__EXCALIDRAW_FONTS__[${JSON.stringify(key.includes('/Xiaolai/') ? fallback : key)}]`)
    return { contents, loader: 'js', resolveDir: path.dirname(args.path) }
  })
} }
const guest = await build({ entryPoints: ['src/guest.jsx'], bundle: true, write: false, format: 'iife', target: 'chrome120', minify: true, legalComments: 'eof', metafile: true, plugins: [plugin], define: { 'process.env.NODE_ENV': '"production"' } })
let css = await readFile(path.join(prod, 'index.css'), 'utf8')
css = css.replace(/url\((['"]?)(\.\/fonts\/[^)'"\s]+)\1\)/g, (_, q, key) => `url("${assets[key] || ''}")`)
if (/url\([^)]*\.woff2/.test(css)) throw new Error('A font CSS asset was not inlined.')
const csp = "default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; font-src data:; img-src data: blob:; media-src data: blob:; connect-src data: blob:; worker-src blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
const safety = `document.addEventListener('click',e=>{if(e.target.closest?.('a'))e.preventDefault()},true);window.open=()=>null;const f=window.fetch;window.fetch=(u,o)=>/^(data:|blob:)/.test(String(u?.url||u))?f(u,o):Promise.reject(new Error('Network access disabled'));window.XMLHttpRequest=class{constructor(){throw new Error('Network access disabled')}};window.WebSocket=class{constructor(){throw new Error('Network access disabled')}};window.EventSource=class{constructor(){throw new Error('Network access disabled')}};navigator.sendBeacon=()=>false;`
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><title>Excalidraw editor</title><style>html,body,#root{height:100%;width:100%;margin:0;overflow:hidden}#lock{position:absolute;inset:0;z-index:2147483647;cursor:wait}.excalidraw .sidebar-trigger{display:none}${css}</style></head><body><div id="root"></div><div id="lock" hidden></div><script>${safety}window.__EXCALIDRAW_FONTS__=${JSON.stringify(assets)};${guest.outputFiles[0].text.replace(/<\/script/gi,'<\\/script')}</script></body></html>`
await writeFile(path.join(out, 'guest.html'), html)
const gzip = gzipSync(html, { level: 9 })
await build({ entryPoints: ['src/plugin.jsx'], outfile: 'dist/plugin.js', bundle: true, format: 'esm', target: 'chrome120', jsx: 'automatic', minify: true, legalComments: 'eof', external: ['react','react/jsx-runtime','@hermes/plugin-sdk'], define: { __GUEST_GZIP__: JSON.stringify(gzip.toString('base64')) } })
const bytes = await readFile(path.join(out, 'plugin.js'))
if (bytes.length > 16 * 1024 * 1024) throw new Error('Plugin exceeds the Desktop loader source limit.')
const report = { id: 'hermes-excalidraw', version: '1.0.0', excalidraw: '0.18.1', bytes: bytes.length, guestBytes: Buffer.byteLength(html), sha256: createHash('sha256').update(bytes).digest('hex'), embeddedFontFiles: Object.keys(assets).length, omittedCJKSubsets: omitted.length, cjkFallback: 'System fonts. Xiaolai font pack is omitted to fit the native plugin size limit.', runtimeNetwork: false, sourceSha256: await sourceFingerprint() }
await writeFile(path.join(out,'build.json'),JSON.stringify(report,null,2)+'\n')
await writeFile(path.join(out,'guest-metafile.json'),JSON.stringify(guest.metafile,null,2)+'\n')
await import('./notices.mjs')
console.log(JSON.stringify(report,null,2))
