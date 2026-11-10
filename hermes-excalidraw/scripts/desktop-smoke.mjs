import { chromium, expect } from '@playwright/test'
import { mkdir, mkdtemp, copyFile, writeFile, access, readFile } from 'node:fs/promises'
import { spawn, execFileSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import { sha256 } from './evidence.mjs'
const hermesRoot=process.env.EXCALIDRAW_HERMES_ROOT || path.join(os.homedir(),'.hermes','hermes-agent')
const executablePath=process.env.EXCALIDRAW_DESKTOP || path.join(hermesRoot,'apps/desktop/release/linux-unpacked/Hermes')
await access(executablePath)
if(!process.env.TMPDIR)throw new Error('Set TMPDIR to the managed scratch directory.')
const root=await mkdtemp(path.join(process.env.TMPDIR,'excalidraw-desktop-')),home=path.join(root,'home'),hermesHome=path.join(home,'.hermes'),userData=path.join(root,'user-data')
await mkdir(path.join(hermesHome,'desktop-plugins/hermes-excalidraw'),{recursive:true});await mkdir(userData,{recursive:true})
await copyFile('dist/plugin.js',path.join(hermesHome,'desktop-plugins/hermes-excalidraw/plugin.js'))
await writeFile(path.join(hermesHome,'config.yaml'),'model:\n  default: excalidraw-test\n  provider: custom\n  base_url: http://127.0.0.1:1/v1\n  api_key: excalidraw-test-not-a-secret\nagent:\n  max_turns: 1\nkanban:\n  dispatch_in_gateway: false\n')
const env=Object.fromEntries(Object.entries(process.env).filter(([k,v])=>v&&!/^_?HERMES_/.test(k)&&!/(API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIALS|ACCESS_KEY|PRIVATE_KEY|BASE_URL)$/.test(k)&&k!=='VIRTUAL_ENV'))
Object.assign(env,{HOME:home,HERMES_HOME:hermesHome,XDG_CONFIG_HOME:path.join(root,'config'),HERMES_DESKTOP_USER_DATA_DIR:userData,HERMES_DESKTOP_IGNORE_EXISTING:'1',HERMES_DESKTOP_HERMES_ROOT:hermesRoot,HERMES_DESKTOP_PYTHON:path.join(hermesRoot,'venv/bin/python'),HERMES_DESKTOP_APP_NAME:`ExcalidrawSmoke-${path.basename(root)}`,HERMES_DESKTOP_SKIP_QUIT_CONFIRM:'1',HERMES_DESKTOP_SKIP_PROTOCOL_REGISTRATION:'1',HERMES_DESKTOP_CDP_PORT:'off',GIT_NO_LAZY_FETCH:'1'})
let browser,child,page;const errors=[],guestRequests=[]
async function bridge(type, extra = {}) {
  return page.evaluate(({ type, extra }) => new Promise((resolve, reject) => {
    const f = document.querySelector('iframe[title="Excalidraw editor"]'), p = new URLSearchParams(f.src.split('#')[1]), requestId = crypto.randomUUID()
    const timer = setTimeout(() => { removeEventListener('message', listen); reject(new Error('Guest request timed out')) }, 20000)
    function listen(event) {
      if (event.source !== f.contentWindow || event.data?.token !== p.get('token') || event.data?.documentId !== p.get('documentId') || event.data?.requestId !== requestId) return
      clearTimeout(timer); removeEventListener('message', listen)
      event.data.error ? reject(new Error(event.data.error)) : resolve(event.data)
    }
    addEventListener('message', listen)
    f.contentWindow.postMessage({ channel: 'hermes-excalidraw-v1', token: p.get('token'), documentId: p.get('documentId'), type, requestId, ...extra }, '*')
  }), { type, extra })
}
try {
  const endpoint=await new Promise((resolve,reject)=>{
    child=spawn(executablePath,['--disable-gpu','--ozone-platform=wayland','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1'],{env,cwd:path.join(hermesRoot,'apps/desktop'),stdio:['ignore','pipe','pipe'],detached:true})
    const timer=setTimeout(()=>reject(new Error('Desktop CDP startup timed out.')),60000)
    child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);reject(new Error(`Desktop exited: ${code}`))})
    child.stderr.on('data',chunk=>{const match=chunk.toString().match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match){clearTimeout(timer);resolve(match[1])}})
  })
  browser=await chromium.connectOverCDP(endpoint)
  for(let i=0;i<120&&!page;i++){page=browser.contexts().flatMap(c=>c.pages())[0];if(!page)await new Promise(r=>setTimeout(r,250))}
  if(!page)throw new Error('No packaged Desktop renderer was exposed.')
  page.on('pageerror',e=>errors.push(e.message))
  page.on('request',req=>{if(/^https?:/.test(req.url())){try{if(req.frame().parentFrame())guestRequests.push(req.url())}catch{}}})
  await page.waitForLoadState('domcontentloaded')
  const pluginRoot=await page.evaluate(()=>window.hermesDesktop.desktopPluginsRoot())
  expect(pluginRoot).toBe(path.join(hermesHome,'desktop-plugins'))
  await page.getByRole('button',{name:'Excalidraw',exact:true}).click({timeout:180000})
  await expect(page.getByRole('region',{name:'Excalidraw',exact:true})).toBeVisible()
  await expect(page.getByRole('button',{name:'New drawing',exact:true})).toBeEnabled({timeout:30000})
  await page.getByRole('button',{name:'New drawing',exact:true}).click()
  await expect(page.getByRole('button',{name:'Export scene',exact:true})).toBeEnabled({timeout:30000})
  const frame=page.frameLocator('iframe[title="Excalidraw editor"]'),canvas=frame.locator('canvas').last()
  await expect(canvas).toBeVisible({timeout:30000});const box=await canvas.boundingBox()
  await canvas.click({position:{x:Math.min(400,box.width-50),y:200}});await page.keyboard.press('r')
  await page.mouse.move(box.x+Math.min(250,box.width-200),box.y+160);await page.mouse.down();await page.mouse.move(box.x+Math.min(450,box.width-40),box.y+300,{steps:10});await page.mouse.up()
  await expect(page.getByRole('region',{name:'Excalidraw',exact:true}).getByRole('status')).toHaveText('Saved locally',{timeout:15000})
  const readLocal=()=>page.evaluate(async()=>{const req=indexedDB.open('hermes-excalidraw-local-v1');const db=await new Promise((r,j)=>{req.onsuccess=()=>r(req.result);req.onerror=()=>j(req.error)});const tx=db.transaction('documents'),q=tx.objectStore('documents').getAll();const rows=await new Promise((r,j)=>{q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error)});db.close();return rows})
  await bridge('lock', { locked: true })
  const keyboardLock = await frame.locator('body').evaluate(() => {
    const event = new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true })
    document.dispatchEvent(event)
    return { inert: document.getElementById('root').inert, keyboardCancelled: event.defaultPrevented }
  })
  expect(keyboardLock).toEqual({ inert: true, keyboardCancelled: true })
  await bridge('lock', { locked: false })
  const complete = JSON.parse((await bridge('export', { format: 'json' })).text)
  await frame.locator('body').evaluate(() => {
    const dt = new DataTransfer(); dt.items.add(new File(['corrupt png'], 'failed.png', { type: 'image/png' }))
    document.querySelector('canvas.interactive').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: 450, clientY: 300, dataTransfer: dt }))
  })
  await expect(page.getByRole('alert')).toContainText('Image processing failed', { timeout: 15000 })
  const recovery = JSON.parse((await bridge('export', { format: 'json', recovery: true })).text)
  expect(recovery.elements.map(el => el.id)).toEqual(complete.elements.map(el => el.id))
  expect(recovery.files).toEqual(complete.files)
  await page.getByRole('button', { name: 'Cancel image and restore previous scene', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Export scene', exact: true })).toBeEnabled({ timeout: 30000 })
  await expect(page.getByRole('region', { name: 'Excalidraw', exact: true }).getByRole('status')).toHaveText('Saved locally')
  expect((await readLocal())[0].scene.elements.map(el => el.id)).toEqual(complete.elements.map(el => el.id))
  await frame.locator('body').evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64
    const context=canvas.getContext('2d');context.fillStyle='#c33';context.fillRect(0,0,64,64)
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'))
    const dataTransfer=new DataTransfer();dataTransfer.items.add(new File([blob],'packaged-smoke.png',{type:'image/png'}))
    document.querySelector('canvas.interactive').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,clientX:450,clientY:300,dataTransfer}))
  })
  await expect.poll(async()=>Object.keys((await readLocal())[0].scene.files).length,{timeout:15000}).toBe(1)
  await expect(page.getByRole('region',{name:'Excalidraw',exact:true}).getByRole('status')).toHaveText('Saved locally',{timeout:15000})
  const before=await readLocal();expect(before).toHaveLength(1);expect(before[0].scene.elements.filter(e=>!e.isDeleted)).toHaveLength(2)
  await page.getByRole('button',{name:'About',exact:true}).click()
  await expect(page.getByRole('note')).toContainText('CJK and other missing glyphs')
  await page.getByRole('button',{name:'About',exact:true}).click()
  const sandbox=await page.locator('iframe[title="Excalidraw editor"]').getAttribute('sandbox');expect(sandbox).toBe('allow-scripts')
  const isolation=await frame.locator('body').evaluate(()=>{let denied=false;try{parent.document.body}catch{denied=true}return{denied,preload:!!window.hermesDesktop}});expect(isolation).toEqual({denied:true,preload:false})
  const exports=await page.evaluate(async()=>{
    const f=document.querySelector('iframe[title="Excalidraw editor"]'),p=new URLSearchParams(f.src.split('#')[1]),results={}
    for(const format of ['json','png','svg'])results[format]=await new Promise((resolve,reject)=>{
      const id=crypto.randomUUID(),timer=setTimeout(()=>{removeEventListener('message',listen);reject(new Error('Export timed out'))},20000)
      function listen(e){if(e.source!==f.contentWindow||e.data?.token!==p.get('token')||e.data?.requestId!==id)return;clearTimeout(timer);removeEventListener('message',listen);e.data.error?reject(new Error(e.data.error)):resolve({bytes:e.data.bytes?.byteLength||e.data.text?.length,format:e.data.format})}
      addEventListener('message',listen);f.contentWindow.postMessage({channel:'hermes-excalidraw-v1',token:p.get('token'),documentId:p.get('documentId'),type:'export',requestId:id,format},'*')
    })
    return results
  })
  for(const item of Object.values(exports))expect(item.bytes).toBeGreaterThan(100)
  await page.reload();await page.getByRole('button',{name:'Excalidraw',exact:true}).click({timeout:180000});await expect(page.getByRole('button',{name:'Export scene',exact:true})).toBeEnabled({timeout:30000})
  const after=await readLocal();expect(after[0].scene.elements.map(e=>e.id)).toEqual(before[0].scene.elements.map(e=>e.id));expect(Object.keys(after[0].scene.files)).toEqual(Object.keys(before[0].scene.files))
  await page.screenshot({path:'dist/desktop-smoke.png'})
  expect(errors).toEqual([]);expect(guestRequests).toEqual([])
  const result={pluginSha256:sha256(await readFile('dist/plugin.js')),shell:'packaged Hermes Desktop',executablePath,pluginRoot,sandbox,isolation,drawSaveReopen:true,localImageSaveReopen:true,noticesVisible:true,keyboardLock,failedImageRecoveryAndCancel:true,reopenMethod:'renderer reload and IndexedDB read-back',guestExports:exports,guestHttpRequests:guestRequests,errors,screenshot:path.resolve('dist/desktop-smoke.png'),isolatedDataPath:root,nativeSaveDialogTested:false}
  await writeFile('dist/desktop-smoke.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2))
}catch(error){console.error('Desktop smoke failed:',error.stack,'\nIsolated data retained:',root,'\nErrors:',errors);if(page){console.error((await page.locator('body').innerText().catch(()=>'' )).slice(-5000));await page.screenshot({path:'dist/desktop-smoke-failed.png'}).catch(()=>{})}process.exitCode=1}
finally{
  if(child?.pid)try{process.kill(-child.pid,'SIGTERM')}catch{}
  if(browser)await Promise.race([browser.close().catch(()=>{}),new Promise(r=>setTimeout(r,3000))])
  try{execFileSync(path.join(hermesRoot,'venv/bin/python'),['-m','hermes_cli.main','gateway','stop','--yes'],{env,cwd:hermesRoot,timeout:30000,stdio:'pipe'})}catch{}
}
