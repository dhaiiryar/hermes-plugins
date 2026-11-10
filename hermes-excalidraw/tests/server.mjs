import { build } from 'esbuild'
import http from 'node:http'
import { readFile } from 'node:fs/promises'
await build({ entryPoints: ['tests/harness.jsx'], outfile: 'test-build/harness.js', bundle: true, format: 'esm', jsx: 'automatic', alias: { '@hermes/plugin-sdk': './tests/sdk.jsx' }, define: { 'process.env.NODE_ENV': '"production"' } })
http.createServer(async (req,res) => {
  if (req.url === '/harness.js') { res.setHeader('content-type','text/javascript'); res.end(await readFile('test-build/harness.js')); return }
  res.setHeader('content-type','text/html'); res.end('<!doctype html><html><head><style>html,body,#root{margin:0;height:100%;width:100%}body{--ui-text-primary:#222;--ui-text-secondary:#666;--ui-stroke-secondary:#ccc;--ui-bg-secondary:#eee;--ui-accent:#5b4fff}#root{display:flex;flex-direction:column}#workspace{flex:1;min-height:0}button{padding:6px}</style></head><body><div id="root"></div><script type="module" src="/harness.js"></script></body></html>')
}).listen(4187,'127.0.0.1')
