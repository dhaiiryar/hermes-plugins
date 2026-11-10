export const CHANNEL = 'hermes-excalidraw-v1'
export const MAX_BYTES = 12 * 1024 * 1024
export const DB_NAME = 'hermes-excalidraw-local-v1'
const TYPES = new Set(['rectangle', 'diamond', 'ellipse', 'line', 'arrow', 'freedraw', 'text', 'image', 'frame', 'selection'])

export function validateScene(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.elements) || value.elements.length > 20000) throw new Error('Invalid Excalidraw scene.')
  if (JSON.stringify(value).length > MAX_BYTES) throw new Error('Scene exceeds the 12 MiB local limit.')
  for (const el of value.elements) {
    if (!el || typeof el.id !== 'string' || el.id.length > 256 || !TYPES.has(el.type)) throw new Error('Unsupported or malformed drawing element.')
    for (const key of ['x', 'y', 'width', 'height']) if (!Number.isFinite(el[key]) || Math.abs(el[key]) > 1e8) throw new Error('Invalid element geometry.')
    if (el.type === 'text' && typeof el.text !== 'string') throw new Error('Invalid text element.')
    if (el.link != null && (typeof el.link !== 'string' || el.link.length > 2048)) throw new Error('Invalid element link. Links must be text under 2049 characters.')
  }
  const files = value.files || {}
  if (!files || typeof files !== 'object' || Array.isArray(files) || Object.keys(files).length > 100) throw new Error('Invalid scene images.')
  for (const [id, file] of Object.entries(files)) {
    if (!file || file.id !== id || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.mimeType) || typeof file.dataURL !== 'string' || !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(file.dataURL)) throw new Error('Only embedded PNG, JPEG, WebP and GIF images are allowed.')
  }
  for (const el of value.elements) if (el.type === 'image' && el.fileId && !files[el.fileId]) throw new Error('An image is missing. Wait for image processing before saving.')
  return { elements: value.elements, appState: cleanAppState(value.appState), files }
}

export function cleanAppState(state = {}) {
  const out = {}
  for (const key of ['viewBackgroundColor', 'scrollX', 'scrollY', 'zoom', 'currentItemFontFamily', 'currentItemStrokeColor', 'currentItemBackgroundColor', 'currentItemFillStyle', 'currentItemStrokeWidth', 'currentItemRoughness', 'currentItemOpacity', 'gridSize']) if (state[key] !== undefined) out[key] = state[key]
  return out
}
export function parseScene(text) {
  if (typeof text !== 'string' || text.length > MAX_BYTES) throw new Error('Import exceeds the 12 MiB limit.')
  const value = JSON.parse(text)
  if (value.type !== 'excalidraw' || value.version !== 2) throw new Error('Choose an Excalidraw .excalidraw file, version 2.')
  return validateScene(value)
}
export function acceptsMessage(event, source, token, documentId) {
  const msg = event.data
  return !!source && event.source === source && !!msg && msg.channel === CHANNEL && msg.token === token && msg.documentId === documentId && typeof msg.type === 'string'
}
export function download(blob, name) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url; anchor.download = name; anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}

export function openStore(factory = indexedDB) {
  return new Promise((resolve, reject) => {
    const req = factory.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore('documents', { keyPath: 'id' })
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('Local storage upgrade is blocked. Close the other Excalidraw tab.'))
    req.onsuccess = () => {
      const db = req.result
      db.onversionchange = () => db.close()
      function transact(mode, operation) {
        return new Promise((ok, fail) => {
          const tx = db.transaction('documents', mode)
          let result
          try { operation(tx.objectStore('documents'), value => { result = value }) } catch (err) { tx.abort(); fail(err); return }
          tx.oncomplete = () => ok(result)
          tx.onabort = tx.onerror = () => fail(tx.error || new Error('Local transaction did not commit.'))
        })
      }
      resolve({
        list: () => transact('readonly', (s, done) => { s.getAll().onsuccess = e => done(e.target.result.sort((a,b) => b.updatedAt-a.updatedAt)) }),
        create: (id, title, scene) => {
          const row = { id, title: title.slice(0,120), scene: validateScene(scene), revision: 0, updatedAt: Date.now() }
          return transact('readwrite', (s, done) => { s.add(row); done(row) })
        },
        save: (id, scene, expectedRevision) => {
          const valid = validateScene(scene)
          return transact('readwrite', (s, done) => { s.get(id).onsuccess = event => {
            const row = event.target.result
            if (!row || row.revision !== expectedRevision) { event.target.transaction?.abort?.(); s.transaction.abort(); return }
            const next = { ...row, scene: valid, revision: row.revision + 1, updatedAt: Date.now() }
            s.put(next); done(next)
          } })
        },
        close: () => db.close(),
      })
    }
  })
}
