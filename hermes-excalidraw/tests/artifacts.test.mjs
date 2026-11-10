import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { sha256 } from '../scripts/evidence.mjs'

test('bundled build and complete third-party notices match their manifests', async () => {
  const build = JSON.parse(await readFile('dist/build.json', 'utf8'))
  assert.equal(sha256(await readFile('dist/plugin.js')), build.sha256)
  assert.equal(build.embeddedFontFiles, 25)
  assert.equal(build.omittedCJKSubsets, 209)
  assert.equal(build.runtimeNetwork, false)
  const manifest = JSON.parse(await readFile('dist/notices-manifest.json', 'utf8'))
  const notices = await readFile('dist/THIRD_PARTY_NOTICES.md', 'utf8')
  assert.equal(sha256(notices), manifest.sha256)
  for (const font of manifest.fonts) assert.ok(notices.includes(`## Font: ${font}`))
  assert.equal(manifest.fonts.length, 8)
  for (const pkg of manifest.packages) { assert.ok(pkg.license); assert.ok(notices.includes(`## ${pkg.name} ${pkg.version}`)) }
  assert.ok(notices.includes('SIL OPEN FONT LICENSE Version 1.1'))
  assert.ok(notices.includes('Copyright (c) 2020 Excalidraw'))
  assert.ok(notices.includes('Copyright (c) 2018 Shannon Miwa'))
})
