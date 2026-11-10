import { test, expect } from '@playwright/test'

const status = page => page.getByRole('region', { name: 'Excalidraw', exact: true }).getByRole('status')
const guest = page => page.frames().find(frame => frame.url().startsWith('blob:'))
async function start(page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Excalidraw', exact: true }).click()
  await expect(page.getByRole('button', { name: 'New drawing', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'New drawing', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Export scene', exact: true })).toBeEnabled({ timeout: 30000 })
  await expect(page.frameLocator('iframe').locator('canvas.interactive')).toBeVisible()
}
async function bytes(download) {
  const chunks = []
  for await (const chunk of await download.createReadStream()) chunks.push(chunk)
  return Buffer.concat(chunks)
}
async function exportScene(page, label = 'Export scene') {
  const next = page.waitForEvent('download')
  await page.getByRole('button', { name: label, exact: true }).click()
  return JSON.parse((await bytes(await next)).toString())
}
async function draw(page) {
  const canvas = page.frameLocator('iframe').locator('canvas.interactive'), box = await canvas.boundingBox()
  await canvas.click({ position: { x: 450, y: 250 } })
  await page.keyboard.press('r')
  await page.mouse.move(box.x + 400, box.y + 220); await page.mouse.down()
  await page.mouse.move(box.x + 600, box.y + 400, { steps: 8 }); await page.mouse.up()
  await expect(status(page)).toHaveText('Saved locally')
}
async function drop(page, mode = 'hang') {
  await guest(page).evaluate(async mode => {
    const c = document.createElement('canvas'); c.width = 32; c.height = 32
    c.getContext('2d').fillRect(0, 0, 32, 32)
    const blob = mode === 'decode' ? new Blob(['invalid png bytes'], { type: 'image/png' }) : await new Promise(r => c.toBlob(r, 'image/png'))
    if (mode === 'hang' || mode === 'timeout') FileReader.prototype.readAsDataURL = function () {}
    if (mode === 'timeout') {
      const native = window.setTimeout
      window.setTimeout = (fn, delay, ...args) => native(fn, delay === 30000 ? 100 : delay, ...args)
    }
    if (mode === 'delay') {
      const native = FileReader.prototype.readAsDataURL
      FileReader.prototype.readAsDataURL = function (...args) { setTimeout(() => native.apply(this, args), 700) }
    }
    const dt = new DataTransfer(); dt.items.add(new File([blob], 'review.png', { type: 'image/png' }))
    document.querySelector('canvas.interactive').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: 450, clientY: 300, dataTransfer: dt }))
  }, mode)
}

for (const operation of ['export', 'switch']) test(`keyboard lock is inert and commits active text during ${operation}`, async ({ page }) => {
  await start(page)
  const id = await page.getByLabel('Drawing').inputValue()
  const canvas = page.frameLocator('iframe').locator('canvas.interactive')
  await canvas.click({ position: { x: 450, y: 250 } }); await page.keyboard.press('t')
  await canvas.click({ position: { x: 450, y: 250 } }); await page.keyboard.insertText('text before lock')
  await expect(page.frameLocator('iframe').locator('textarea')).toBeFocused()
  // Keep a real transaction alive so the parent action stays locked while the
  // guest has keyboard focus. No editor callbacks or save results are mocked.
  await page.evaluate(async () => {
    const q = indexedDB.open('hermes-excalidraw-local-v1')
    const db = await new Promise(r => q.onsuccess = () => r(q.result))
    const tx = db.transaction('documents', 'readwrite'), s = tx.objectStore('documents'), until = performance.now() + 1800
    function hold() { s.get('hold').onsuccess = () => { if (performance.now() < until) hold() } }
    hold(); tx.oncomplete = () => db.close()
  })
  const next = operation === 'export' ? page.waitForEvent('download') : null
  await page.evaluate(label => [...document.querySelectorAll('button')].find(b => b.textContent === label).click(), operation === 'export' ? 'Export scene' : 'New drawing')
  await expect.poll(() => guest(page).evaluate(() => document.getElementById('root').inert)).toBe(true)
  const guarded = await guest(page).evaluate(() => {
    const key = new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true })
    document.dispatchEvent(key)
    return { cancelled: key.defaultPrevented, active: document.activeElement?.tagName, inert: document.getElementById('root').inert }
  })
  expect(guarded).toEqual({ cancelled: true, active: 'BODY', inert: true })
  await page.keyboard.press('Control+a'); await page.keyboard.press('Backspace'); await page.keyboard.insertText('must not appear')
  if (next) {
    const exported = JSON.parse((await bytes(await next)).toString())
    expect(exported.elements.filter(el => !el.isDeleted).map(el => el.text)).toEqual(['text before lock'])
    await expect.poll(() => guest(page).evaluate(() => document.getElementById('root').inert)).toBe(false)
  } else {
    await expect(page.getByLabel('Drawing').locator('option')).toHaveCount(2)
    await page.getByLabel('Drawing').selectOption(id)
    await expect(page.getByRole('button', { name: 'Export scene', exact: true })).toBeEnabled()
  }
  const saved = await exportScene(page)
  expect(saved.elements.filter(el => !el.isDeleted).map(el => el.text)).toEqual(['text before lock'])
  await page.reload(); await page.getByRole('button', { name: 'Excalidraw', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Export scene', exact: true })).toBeEnabled()
  expect((await exportScene(page)).elements.filter(el => !el.isDeleted).map(el => el.text)).toEqual(['text before lock'])
})

for (const mode of ['decode', 'timeout']) test(`${mode} failure permits last-complete recovery, cancellation, editing and switching`, async ({ page }) => {
  await start(page); await draw(page)
  const before = await exportScene(page), oldFrame = guest(page)
  await drop(page, mode)
  await expect(page.getByRole('alert')).toContainText('Image processing failed', { timeout: 15000 })
  await expect(status(page)).not.toHaveText('Saved locally')
  const recovered = await exportScene(page, 'Export recovery')
  expect(recovered.elements.map(el => el.id)).toEqual(before.elements.map(el => el.id))
  expect(recovered.files).toEqual(before.files)
  await page.getByRole('button', { name: 'Cancel image and restore previous scene', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Export scene', exact: true })).toBeEnabled()
  expect(guest(page)).not.toBe(oldFrame)
  await expect(status(page)).toHaveText('Saved locally')
  expect((await exportScene(page)).elements.map(el => el.id)).toEqual(before.elements.map(el => el.id))
  await draw(page)
  expect((await exportScene(page)).elements.filter(el => !el.isDeleted)).toHaveLength(2)
  await page.getByRole('button', { name: 'New drawing', exact: true }).click()
  await expect(page.getByLabel('Drawing').locator('option')).toHaveCount(2)
  await expect(page.getByRole('button', { name: 'Export scene', exact: true })).toBeEnabled()
})

test('created links survive save, export and reopen but never navigate or become SVG anchors', async ({ page, context }) => {
  const external = [], dialogs = []
  context.on('request', req => { if (/^https?:/.test(req.url()) && !req.url().startsWith('http://127.0.0.1:4187')) external.push(req.url()) })
  page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.dismiss() })
  await start(page); await draw(page)
  const canvas = page.frameLocator('iframe').locator('canvas.interactive')
  await canvas.click({ position: { x: 500, y: 220 } }); await page.keyboard.press('Control+k')
  const input = page.frameLocator('iframe').locator('.excalidraw-hyperlinkContainer-input')
  await expect(input).toBeVisible(); await input.fill('https://example.com/preserved?query=1#link'); await input.press('Enter')
  await expect(status(page)).toHaveText('Saved locally')
  const link = page.frameLocator('iframe').locator('a.excalidraw-hyperlinkContainer-link')
  await expect(link).toBeVisible(); await link.click()
  expect(context.pages()).toHaveLength(1)
  const original = await exportScene(page)
  expect(original.elements.find(el => el.link)?.link).toBe('https://example.com/preserved?query=1#link')
  const next = page.waitForEvent('download'); await page.getByRole('button', { name: 'SVG', exact: true }).click()
  const svg = (await bytes(await next)).toString()
  expect(svg).not.toMatch(/<a\b|href="https?:|javascript:/)
  await page.reload(); await page.getByRole('button', { name: 'Excalidraw', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Export scene', exact: true })).toBeEnabled()
  expect((await exportScene(page)).elements.find(el => el.link)?.link).toBe('https://example.com/preserved?query=1#link')
  expect(external).toEqual([]); expect(dialogs).toEqual([])
})

test('offline SVG text survives without embedded fonts and exposes the documented fallback', async ({ page, context }) => {
  const requests = []
  await start(page)
  const canvas = page.frameLocator('iframe').locator('canvas.interactive')
  await canvas.click({ position: { x: 450, y: 250 } }); await page.keyboard.press('t')
  await canvas.click({ position: { x: 450, y: 250 } }); await page.keyboard.insertText('Offline font fallback')
  await page.keyboard.press('Escape')
  await context.setOffline(true)
  await page.getByRole('button', { name: 'About', exact: true }).click()
  await expect(page.getByRole('note')).toContainText('SVG exports do not embed fonts')
  await expect(page.getByRole('note')).toContainText('Use PNG for a fixed appearance')
  await page.getByRole('button', { name: 'About', exact: true }).click()
  const next = page.waitForEvent('download'); await page.getByRole('button', { name: 'SVG', exact: true }).click()
  const svg = (await bytes(await next)).toString()
  expect(svg).toContain('Offline font fallback'); expect(svg).toContain('font-family=')
  expect(svg).not.toMatch(/@font-face|data:font|url\(\s*["']?https?:/)
  const rendered = await context.newPage()
  rendered.on('request', req => requests.push(req.url()))
  await rendered.setContent(svg)
  const text = rendered.locator('svg text')
  await expect(text).toHaveText('Offline font fallback')
  expect(await text.evaluate(el => el.getBBox().width)).toBeGreaterThan(30)
  await rendered.screenshot({ path: 'test-results/offline-svg-text.png' })
  expect(requests).toEqual([])
})

test('save fault outranks media start and completion; cancel never clears a conflict', async ({ page }) => {
  await start(page); await draw(page)
  await page.evaluate(async () => {
    const q = indexedDB.open('hermes-excalidraw-local-v1'), db = await new Promise(r => q.onsuccess = () => r(q.result))
    await new Promise(r => { const tx = db.transaction('documents', 'readwrite'), s = tx.objectStore('documents'); s.getAll().onsuccess = e => { const row = e.target.result[0]; s.put({ ...row, revision: row.revision + 10 }) }; tx.oncomplete = r }); db.close()
  })
  const canvas = page.frameLocator('iframe').locator('canvas.interactive')
  await canvas.click({ position: { x: 500, y: 300 } }); await page.keyboard.press('Delete')
  await expect(status(page)).toHaveText('Not saved')
  await page.evaluate(() => {
    window.statusChanges = []
    const node = document.querySelector('.hex [role="status"]')
    new MutationObserver(() => window.statusChanges.push(node.textContent)).observe(node, { childList: true, characterData: true, subtree: true })
  })
  await drop(page, 'delay')
  await expect(page.getByRole('button', { name: 'Cancel image and restore previous scene', exact: true })).toBeVisible()
  await expect(status(page)).toHaveText('Not saved')
  await expect(page.getByRole('button', { name: 'Cancel image and restore previous scene', exact: true })).toHaveCount(0, { timeout: 10000 })
  await expect(status(page)).toHaveText('Not saved')
  expect((await exportScene(page, 'Export recovery')).elements.some(el => el.type === 'image')).toBe(true)
  expect(await page.evaluate(() => window.statusChanges.every(text => text === 'Not saved'))).toBe(true)
  await drop(page, 'hang')
  await expect(status(page)).toHaveText('Not saved')
  await page.getByRole('button', { name: 'Cancel image and restore previous scene', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Export scene', exact: true })).toBeEnabled()
  await expect(status(page)).toHaveText('Not saved')
  const retained = await exportScene(page, 'Export recovery')
  expect(retained.elements.some(el => el.type === 'image')).toBe(true)
  await expect(status(page)).toHaveText('Not saved')
})
