import { readFile, writeFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

const metafile = JSON.parse(await readFile('dist/guest-metafile.json', 'utf8'))
const roots = new Set()
for (const file of Object.keys(metafile.inputs)) {
  if (!file.startsWith('node_modules/')) continue
  let dir = path.dirname(path.resolve(file))
  while (dir !== path.dirname(dir)) {
    try {
      const pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'))
      if (pkg.name) { roots.add(dir); break }
    } catch {}
    dir = path.dirname(dir)
  }
}
const vendors = {}
for (const name of await readdir('licenses')) {
  if (name.endsWith('.txt')) vendors[name.slice(0, -4)] = await readFile(path.join('licenses', name), 'utf8')
}
for (const name of ['Excalidraw', 'Radix', 'ReactRemoveScrollBar', 'Fuzzy', 'Assistant', 'Cascadia', 'ComicShanns', 'Excalifont', 'Liberation', 'Lilita', 'Nunito', 'Virgil']) {
  if (!vendors[name] || !/THE (FONT )?SOFTWARE IS PROVIDED/i.test(vendors[name])) throw new Error(`Missing complete vendored license: ${name}`)
}
const notices = [
  '# Third-party notices',
  'Excalidraw is MIT licensed. No account, subscription or production license key is required.',
  'Font binaries are embedded unchanged from the upstream package, including its existing subsets. The Xiaolai pack is not distributed. Complete font license text and upstream attributions follow the npm notices.',
  '\n## Plugin source\n', await readFile('LICENSE', 'utf8'),
]
const packages = [], seen = new Set()
for (const dir of [...roots].sort()) {
  const pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'))
  const key = `${pkg.name}@${pkg.version}`
  if (seen.has(key)) continue
  seen.add(key)
  const license = pkg.license || pkg.licenses
  if (!license) throw new Error(`Missing license declaration: ${key}`)
  notices.push(`\n## ${pkg.name} ${pkg.version}\n\nLicense: ${typeof license === 'string' ? license : JSON.stringify(license)}\n`)
  const texts = []
  for (const filename of (await readdir(dir)).sort()) {
    if (/^(licen[cs]e|copying|notice)/i.test(filename)) texts.push(await readFile(path.join(dir, filename), 'utf8'))
  }
  if (!texts.length) {
    const fallback = pkg.name.startsWith('@radix-ui/') ? 'Radix' : ({ '@excalidraw/excalidraw': 'Excalidraw', 'react-remove-scroll-bar': 'ReactRemoveScrollBar', fuzzy: 'Fuzzy' })[pkg.name]
    if (!fallback) throw new Error(`No license text for bundled package: ${key}`)
    texts.push(vendors[fallback])
  }
  notices.push(...texts)
  packages.push({ name: pkg.name, version: pkg.version, license })
}
for (const name of ['Assistant', 'Cascadia', 'ComicShanns', 'Excalifont', 'Liberation', 'Lilita', 'Nunito', 'Virgil']) notices.push(`\n## Font: ${name}\n\n${vendors[name]}`)
const text = notices.join('\n') + '\n'
await writeFile('dist/THIRD_PARTY_NOTICES.md', text)
await writeFile('dist/notices-manifest.json', JSON.stringify({ packages, fonts: ['Assistant', 'Cascadia', 'ComicShanns', 'Excalifont', 'Liberation', 'Lilita', 'Nunito', 'Virgil'], sha256: createHash('sha256').update(text).digest('hex') }, null, 2) + '\n')
console.log(`Notices include ${packages.length} bundled npm package versions and 8 font families, all with license text.`)
