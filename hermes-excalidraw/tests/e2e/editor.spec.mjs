import { test, expect } from '@playwright/test'
const normalized = elements => elements.map(el => ({ ...el, boundElements: el.boundElements || [] }))
const status = page => page.getByRole('status').filter({ hasText: /Saved locally|Unsaved|Saving|Not saved/ })
async function open(page) {
  await page.goto('/')
  await page.getByRole('button', { name:'Excalidraw', exact:true }).click()
  await expect(page.getByRole('button', { name:'New drawing', exact:true })).toBeEnabled()
}
async function create(page) {
  await page.getByRole('button', { name:'New drawing', exact:true }).click()
  await expect(page.getByRole('button',{name:'Export scene',exact:true})).toBeEnabled({timeout:30000})
  const frame = page.frameLocator('iframe[title="Excalidraw editor"]')
  await expect(frame.locator('canvas').first()).toBeVisible({timeout:30000})
  return frame
}
async function draw(page) {
  const frame=page.frameLocator('iframe[title="Excalidraw editor"]')
  const canvas=frame.locator('canvas').last(), box=await canvas.boundingBox()
  await canvas.click({position:{x:450,y:250}})
  await page.keyboard.press('r')
  await page.mouse.move(box.x+400,box.y+250);await page.mouse.down();await page.mouse.move(box.x+620,box.y+420,{steps:12});await page.mouse.up()
  await expect(status(page)).toHaveText('Saved locally',{timeout:15000})
}
async function exported(page) {
  const next=page.waitForEvent('download')
  await page.getByRole('button',{name:'Export scene',exact:true}).click()
  const download=await next
  const stream=await download.createReadStream();const chunks=[];for await(const part of stream) chunks.push(part)
  return JSON.parse(Buffer.concat(chunks).toString())
}

test('opaque sandbox: draw, commit, reopen, import copy, JSON/PNG/SVG offline', async ({page, context})=>{
  const external=[],errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  context.on('request',req=>{if(/^https?:/.test(req.url())&&!req.url().startsWith('http://127.0.0.1:4187'))external.push(req.url())})
  await context.route(/^https?:\/\/(?!127\.0\.0\.1:4187)/,route=>route.abort())
  await open(page);const frame=await create(page)
  await draw(page)
  const scene=await exported(page);expect(scene.elements.filter(el=>!el.isDeleted).length).toBe(1)
  expect(await page.locator('iframe').getAttribute('sandbox')).toBe('allow-scripts')
  const opaque=await frame.locator('body').evaluate(()=>{let parentDenied=false,storageDenied=false;try{parent.document.body}catch{parentDenied=true}try{localStorage.length}catch{storageDenied=true}return{parentDenied,storageDenied,preload:!!window.hermesDesktop}})
  expect(opaque).toEqual({parentDenied:true,storageDenied:true,preload:false})
  await page.reload();await page.getByRole('button',{name:'Excalidraw',exact:true}).click();await expect(page.getByRole('button',{name:'Export scene',exact:true})).toBeEnabled({timeout:30000})
  expect(normalized((await exported(page)).elements)).toEqual(normalized(scene.elements))
  await page.getByLabel('Import Excalidraw file').setInputFiles({name:'Roundtrip.excalidraw',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(scene))})
  await expect(page.getByLabel('Drawing').locator('option')).toHaveCount(2)
  await expect(page.getByRole('button',{name:'Export scene',exact:true})).toBeEnabled({timeout:30000})
  expect(normalized((await exported(page)).elements)).toEqual(normalized(scene.elements))
  for(const label of ['PNG','SVG']){
    const next=page.waitForEvent('download');await page.getByRole('button',{name:label,exact:true}).click();const dl=await next;const stream=await dl.createReadStream();const chunks=[];for await(const c of stream)chunks.push(c);const bytes=Buffer.concat(chunks);expect(bytes.length).toBeGreaterThan(100)
    if(label==='PNG')expect(bytes.subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a');else expect(bytes.toString()).toContain('<svg')
  }
  await expect(status(page)).toHaveText('Saved locally')
  await page.screenshot({path:'test-results/browser-smoke.png'})
  expect(errors).toEqual([]);expect(external).toEqual([])
})

test('reject malformed imports and remote media without replacing drawings',async({page})=>{
  await open(page);await create(page);await draw(page);const original=await exported(page)
  for(const text of ['{bad',JSON.stringify({type:'excalidraw',version:2,elements:[{id:'x',type:'embeddable',x:0,y:0,width:1,height:1,link:'https://example.com'}]})]){
    await page.getByLabel('Import Excalidraw file').setInputFiles({name:'bad.excalidraw',mimeType:'application/json',buffer:Buffer.from(text)})
    await expect(page.getByRole('alert')).toBeVisible();expect(normalized((await exported(page)).elements)).toEqual(normalized(original.elements))
    await expect(page.getByLabel('Drawing').locator('option')).toHaveCount(1)
  }
})

test('theme updates preserve drawings and independent documents',async({page})=>{
  await open(page);await create(page);await draw(page);const original=await exported(page)
  await page.evaluate(()=>window.setTestTheme('dark'))
  await expect(page.frameLocator('iframe').locator('.excalidraw.theme--dark')).toBeVisible()
  expect(normalized((await exported(page)).elements)).toEqual(normalized(original.elements))
  const first=await page.getByLabel('Drawing').inputValue()
  await create(page);expect((await exported(page)).elements).toHaveLength(0)
  await page.getByLabel('Drawing').selectOption(first)
  await expect(page.getByRole('button',{name:'Export scene',exact:true})).toBeEnabled({timeout:30000})
  expect(normalized((await exported(page)).elements)).toEqual(normalized(original.elements))
})
