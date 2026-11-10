import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { sourceFingerprint, sha256 } from './evidence.mjs'

await mkdir('test-results', { recursive: true })
async function run(args, log) {
  console.log(`\n$ npm ${args.join(' ')}`)
  const chunks = []
  await new Promise((resolve, reject) => {
    const child = spawn('npm', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.on('data', chunk => { chunks.push(chunk); process.stdout.write(chunk) })
    child.stderr.on('data', chunk => process.stderr.write(chunk))
    child.once('error', reject)
    child.once('close', async code => {
      try {
        await writeFile(log, Buffer.concat(chunks))
        if (code !== 0) reject(new Error(`npm ${args.join(' ')} failed, exit ${code}`))
        else resolve()
      } catch (error) { reject(error) }
    })
  })
}
await run(['run', 'build'], 'test-results/build.log')
const report = JSON.parse(await readFile('dist/build.json', 'utf8'))
await run(['test'], 'test-results/unit.log')
await run(['run', 'test:e2e'], 'test-results/e2e.log')
await run(['audit', '--json'], 'test-results/audit.json')
await run(['audit', 'signatures'], 'test-results/signatures.log')
await run(['run', 'test:desktop'], 'test-results/desktop.log')
const browser = JSON.parse(await readFile('test-results/browser-results.json', 'utf8'))
const desktop = JSON.parse(await readFile('dist/desktop-smoke.json', 'utf8'))
const audit = JSON.parse(await readFile('test-results/audit.json', 'utf8'))
const hash = sha256(await readFile('dist/plugin.js'))
if (report.sourceSha256 !== await sourceFingerprint() || report.sha256 !== hash || desktop.pluginSha256 !== hash || browser.stats.unexpected || browser.stats.flaky || browser.stats.skipped || browser.stats.expected < 15 || audit.metadata.vulnerabilities.total || !desktop.drawSaveReopen || !desktop.localImageSaveReopen || !desktop.noticesVisible || !desktop.keyboardLock?.inert || !desktop.keyboardLock?.keyboardCancelled || !desktop.failedImageRecoveryAndCancel || desktop.errors.length || desktop.guestHttpRequests.length) throw new Error('Verification evidence does not match this build.')
const evidence = { passed: true, pluginSha256: hash, sourceSha256: report.sourceSha256, noticesSha256: sha256(await readFile('dist/THIRD_PARTY_NOTICES.md')), browserPassed: browser.stats.expected, auditVulnerabilities: audit.metadata.vulnerabilities.total, unitPassed: true, signaturesPassed: true, desktopPassed: true, verifiedAt: new Date().toISOString() }
await writeFile('dist/verification.json', JSON.stringify(evidence, null, 2) + '\n')
console.log(JSON.stringify(evidence, null, 2))
