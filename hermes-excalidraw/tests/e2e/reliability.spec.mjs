import { test, expect } from '@playwright/test'
async function start(page) { await page.goto('/'); await page.getByRole('button',{name:'Excalidraw',exact:true}).click();await expect(page.getByRole('button',{name:'New drawing',exact:true})).toBeEnabled();await page.getByRole('button',{name:'New drawing',exact:true}).click();await expect(page.getByRole('button',{name:'Export scene',exact:true})).toBeEnabled({timeout:30000}) }
const state=page=>page.getByRole('region',{name:'Excalidraw',exact:true}).getByRole('status')
async function scene(page) { const next=page.waitForEvent('download');await page.getByRole('button',{name:'Export scene',exact:true}).click();const stream=await(await next).createReadStream(),chunks=[];for await(const c of stream)chunks.push(c);return JSON.parse(Buffer.concat(chunks).toString()) }

test('pending raster processing never reports Saved; image persists offline',async({page})=>{
  await start(page)
  const guest=page.frames().find(f=>f.url().startsWith('blob:'))
  await guest.evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;const c=canvas.getContext('2d');c.fillStyle='#c33';c.fillRect(0,0,64,64)
    const blob=await new Promise(r=>canvas.toBlob(r,'image/png'))
    const original=FileReader.prototype.readAsDataURL
    FileReader.prototype.readAsDataURL=function(...args){setTimeout(()=>original.apply(this,args),1100)}
    const dt=new DataTransfer();dt.items.add(new File([blob],'local-test.png',{type:'image/png'}))
    document.querySelector('canvas.interactive').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,clientX:450,clientY:300,dataTransfer:dt}))
  })
  await expect(state(page)).toHaveText('Processing local image…')
  await page.waitForTimeout(500);await expect(state(page)).not.toHaveText('Saved locally')
  await page.getByRole('button',{name:'New drawing',exact:true}).click()
  await expect(page.getByRole('alert')).toContainText('Wait for local image processing')
  await expect(page.getByLabel('Drawing').locator('option')).toHaveCount(1)
  await expect(state(page)).toHaveText('Saved locally',{timeout:15000})
  const saved=await scene(page);expect(Object.keys(saved.files)).toHaveLength(1);expect(saved.elements.some(e=>e.type==='image')).toBe(true)
  await page.reload();await page.getByRole('button',{name:'Excalidraw',exact:true}).click();await expect(page.getByRole('button',{name:'Export scene',exact:true})).toBeEnabled({timeout:30000})
  expect(Object.keys((await scene(page)).files)).toEqual(Object.keys(saved.files))
})

test('conflicting transaction cannot claim Saved, recovery export remains available',async({page})=>{
  await start(page)
  await expect(state(page)).toHaveText('Saved locally')
  await page.evaluate(async()=>{
    const q=indexedDB.open('hermes-excalidraw-local-v1');const db=await new Promise(r=>q.onsuccess=()=>r(q.result));await new Promise((r,j)=>{const tx=db.transaction('documents','readwrite'),s=tx.objectStore('documents');s.getAll().onsuccess=e=>{const row=e.target.result[0];s.put({...row,revision:row.revision+10})};tx.oncomplete=r;tx.onabort=j});db.close()
  })
  const canvas=page.frameLocator('iframe').locator('canvas').last();await canvas.click({position:{x:450,y:300}});await page.keyboard.press('r');const box=await canvas.boundingBox();await page.mouse.move(box.x+400,box.y+260);await page.mouse.down();await page.mouse.move(box.x+600,box.y+400);await page.mouse.up()
  await expect(state(page)).toHaveText('Not saved',{timeout:15000});await expect(page.getByRole('alert')).toContainText('Local save failed')
  const next=page.waitForEvent('download');await page.getByRole('button',{name:'Export recovery',exact:true}).click();expect((await next).suggestedFilename()).toBe('recovery.excalidraw')
  await expect(state(page)).toHaveText('Not saved')
})

test('CSP and runtime guards block outbound connections',async({page})=>{
  await start(page)
  const guest=page.frames().find(f=>f.url().startsWith('blob:'))
  const result=await guest.evaluate(async()=>{
    let fetchBlocked=false,webSocketBlocked=false,storageBlocked=false
    try{await fetch('https://example.com/private-scene')}catch{fetchBlocked=true}
    try{new WebSocket('wss://example.com/scene')}catch{webSocketBlocked=true}
    try{parent.localStorage.getItem('anything')}catch{storageBlocked=true}
    const csp=document.querySelector('meta[http-equiv="Content-Security-Policy"]').content
    return{fetchBlocked,webSocketBlocked,storageBlocked,csp}
  })
  expect(result.fetchBlocked&&result.webSocketBlocked&&result.storageBlocked).toBe(true)
  expect(result.csp).toContain('connect-src data: blob:');expect(result.csp).not.toContain('https:')
})

test('SVG insertion is rejected without wedging persistence; local notices are visible',async({page})=>{
  await start(page)
  await page.getByRole('button',{name:'About',exact:true}).click()
  await expect(page.getByRole('note')).toContainText('No account, subscription or license key')
  await expect(page.getByRole('note')).toContainText('CJK and other missing glyphs')
  await expect(page.getByRole('note')).toContainText('SVG exports do not embed fonts')
  await page.getByRole('button',{name:'About',exact:true}).click()
  const guest=page.frames().find(f=>f.url().startsWith('blob:'))
  await guest.evaluate(()=>{
    const dt=new DataTransfer();dt.items.add(new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'],'blocked.svg',{type:'image/svg+xml'}))
    document.querySelector('canvas.interactive').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,clientX:450,clientY:300,dataTransfer:dt}))
  })
  await expect(page.getByRole('alert')).toContainText('SVG insertion is disabled')
  expect((await scene(page)).elements).toHaveLength(0)
  await expect(state(page)).toHaveText('Saved locally')
  await page.getByRole('button',{name:'New drawing',exact:true}).click()
  await expect(page.getByLabel('Drawing').locator('option')).toHaveCount(2)
})

test('failed startup retains malformed board and permits switching after reload',async({page})=>{
  await start(page)
  await expect(state(page)).toHaveText('Saved locally')
  const good=await page.getByLabel('Drawing').inputValue()
  await page.getByRole('button',{name:'New drawing',exact:true}).click()
  await expect(page.getByLabel('Drawing').locator('option')).toHaveCount(2)
  await expect(page.getByRole('button',{name:'Export scene',exact:true})).toBeEnabled()
  const bad=await page.getByLabel('Drawing').inputValue()
  await page.getByLabel('Drawing').selectOption(good)
  await expect(page.getByRole('button',{name:'Export scene',exact:true})).toBeEnabled()
  await page.evaluate(async id=>{
    const q=indexedDB.open('hermes-excalidraw-local-v1');const db=await new Promise(r=>q.onsuccess=()=>r(q.result))
    await new Promise((r,j)=>{const tx=db.transaction('documents','readwrite'),s=tx.objectStore('documents');s.get(id).onsuccess=e=>s.put({...e.target.result,scene:{elements:'malformed-regression-fixture',appState:{},files:{}}});tx.oncomplete=r;tx.onabort=j});db.close()
  },bad)
  await page.getByLabel('Drawing').selectOption(bad)
  await expect(page.getByRole('alert')).toContainText('Invalid Excalidraw scene')
  await page.reload();await page.getByRole('button',{name:'Excalidraw',exact:true}).click()
  await expect(page.getByRole('alert')).toContainText('Invalid Excalidraw scene')
  await page.getByLabel('Drawing').selectOption(good)
  await expect(page.getByRole('button',{name:'Export scene',exact:true})).toBeEnabled({timeout:30000})
  expect((await scene(page)).elements).toHaveLength(0)
  const retained=await page.evaluate(async id=>{
    const q=indexedDB.open('hermes-excalidraw-local-v1');const db=await new Promise(r=>q.onsuccess=()=>r(q.result)),req=db.transaction('documents').objectStore('documents').get(id)
    const row=await new Promise(r=>req.onsuccess=()=>r(req.result));db.close();return row.scene.elements
  },bad)
  expect(retained).toBe('malformed-regression-fixture')
})
