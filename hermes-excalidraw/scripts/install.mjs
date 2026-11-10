import { access, mkdir, readFile, copyFile, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import { sourceFingerprint, sha256 } from './evidence.mjs'
const id='hermes-excalidraw'
const verification=JSON.parse(await readFile('dist/verification.json','utf8'))
const report=JSON.parse(await readFile('dist/build.json','utf8'))
const browser=JSON.parse(await readFile('test-results/browser-results.json','utf8'))
const desktop=JSON.parse(await readFile('dist/desktop-smoke.json','utf8'))
const bytes=await readFile('dist/plugin.js'),hash=createHash('sha256').update(bytes).digest('hex')
if(hash!==report.sha256||!desktop.drawSaveReopen||!desktop.localImageSaveReopen||!desktop.noticesVisible||!desktop.keyboardLock?.inert||!desktop.keyboardLock?.keyboardCancelled||!desktop.failedImageRecoveryAndCancel||desktop.errors.length||desktop.guestHttpRequests.length||browser.stats.unexpected||browser.stats.flaky||browser.stats.skipped||browser.stats.expected<15)throw new Error('Verification evidence is absent or failed. Refusing installation.')
if(!verification.passed || !verification.unitPassed || !verification.signaturesPassed || !verification.desktopPassed || verification.pluginSha256!==hash || verification.sourceSha256!==await sourceFingerprint() || verification.noticesSha256!==sha256(await readFile('dist/THIRD_PARTY_NOTICES.md')))throw new Error('Full verification is missing, stale or failed. Run npm run verify.')
if(desktop.pluginSha256!==hash)throw new Error('Desktop smoke did not verify this exact build. Refusing installation.')
const root=process.env.EXCALIDRAW_PLUGIN_ROOT||path.join(os.homedir(),'.hermes','desktop-plugins')
const target=path.join(root,id)
try { await access(target); throw new Error('The plugin directory already exists. Existing files are preserved; choose an empty installation root or review the installation manually.') } catch(err) { if(err.code!=='ENOENT')throw err }
await mkdir(root,{recursive:true})
await mkdir(target)
for(const filename of ['plugin.js','build.json','THIRD_PARTY_NOTICES.md','verification.json'])await copyFile(path.join('dist',filename),path.join(target,filename),constants.COPYFILE_EXCL)
const installed=await readFile(path.join(target,'plugin.js'))
if(createHash('sha256').update(installed).digest('hex')!==hash)throw new Error('Installed plugin read-back hash differs.')
const receipt={id,path:target,sha256:hash,verifiedReadBack:true,desktopSmoke:desktop.isolatedDataPath}
await writeFile('dist/install-receipt.json',JSON.stringify(receipt,null,2)+'\n')
console.log(JSON.stringify(receipt,null,2))
