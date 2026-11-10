import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Excalidraw, MainMenu, exportToBlob, exportToSvg } from '@excalidraw/excalidraw'
import { CHANNEL, MAX_BYTES, cleanAppState, validateScene } from './core.mjs'

const params = new URLSearchParams(location.hash.slice(1))
const token = params.get('token'), documentId = params.get('documentId')
let api, initialized = false, sequence = 0, timer, locked = false, theme = 'light', renderTheme
let lastKey = '', pendingInteraction = false, mediaPending = false, mediaTimer, imageIdsBefore = new Set(), mediaRecovery, mediaChecking = false, mediaHasFailed = false
const send = (type, data = {}) => parent.postMessage({ channel: CHANNEL, token, documentId, type, ...data }, '*')
const error = err => send('error', { message: String(err?.message || err).slice(0, 400) })
const settledFrames = () => new Promise(resolve => {
  const fallback = setTimeout(resolve, 100)
  requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(fallback); resolve() }))
})
function setLocked(value) {
  locked = value
  // Blur commits an active text editor before the snapshot barrier. Inert alone
  // does not stop document-level editor shortcuts, so capture those below too.
  if (locked) document.activeElement?.blur?.()
  document.getElementById('root').inert = locked
  document.getElementById('lock').hidden = !locked
}
for (const type of ['keydown', 'keyup', 'keypress', 'beforeinput', 'input', 'paste', 'drop', 'change', 'pointerdown', 'pointermove', 'pointerup', 'mousedown', 'mousemove', 'mouseup', 'touchstart', 'touchmove', 'touchend', 'click', 'dblclick', 'contextmenu', 'wheel']) {
  document.addEventListener(type, event => {
    if (locked) { event.preventDefault(); event.stopImmediatePropagation() }
  }, true)
}
function mediaFailed(err) {
  if (mediaPending) {
    clearTimeout(mediaTimer)
    if (mediaHasFailed) return
    mediaHasFailed = true
    send('processing', { pending: true, failed: true })
    error(new Error('Image processing failed. Export recovery for the scene before the image, or cancel the image and restore that scene. Changes since the image started will be discarded on cancellation.'))
  } else error(err)
}
function trackMedia(event) {
  const files = [...(event.clipboardData?.files || event.dataTransfer?.files || event.target?.files || [])]
  const images = files.filter(file => file.type.startsWith('image/'))
  if (!images.length) return
  if (mediaPending) {
    event.preventDefault(); event.stopImmediatePropagation()
    error(new Error('An image is already processing. Cancel it before trying another image.'))
    return
  }
  if (images.some(file => !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) || file.size > MAX_BYTES)) {
    event.preventDefault(); event.stopImmediatePropagation()
    error(new Error('Choose a local PNG, JPEG, WebP or GIF image under 12 MiB. SVG insertion is disabled.'))
    return
  }
  try { mediaRecovery = structuredClone(sceneNow()) } catch (err) { event.preventDefault(); event.stopImmediatePropagation(); error(err); return }
  mediaPending = true
  mediaChecking = false; mediaHasFailed = false
  imageIdsBefore = new Set(api?.getSceneElements().filter(el => el.type === 'image').map(el => el.id) || [])
  send('processing', { pending: true, recoveryScene: mediaRecovery }); dirty()
  clearTimeout(mediaTimer)
  mediaTimer = setTimeout(() => mediaFailed(new Error('Image processing timed out.')), 30000)
}
for (const event of ['paste', 'drop', 'change']) document.addEventListener(event, trackMedia, true)
async function checkMedia(elements, files) {
  if (!mediaPending || mediaChecking || mediaHasFailed) return
  const added = elements.filter(el => el.type === 'image' && !imageIdsBefore.has(el.id))
  if (added.some(el => el.status === 'error')) { mediaFailed(new Error('Image decoding failed.')); return }
  if (!added.length || added.some(el => !el.fileId || !files[el.fileId])) return
  mediaChecking = true
  try {
    // A file record exists before Excalidraw finishes decoding it. It is not
    // proof that insertion succeeded, and must not release the save barrier.
    await Promise.all(added.map(async el => {
      const image = new Image(); image.src = files[el.fileId].dataURL
      await image.decode()
    }))
    if (mediaHasFailed) return
    mediaPending = false; mediaRecovery = undefined; clearTimeout(mediaTimer)
    send('processing', { pending: false }); dirty()
  } catch (err) { mediaFailed(err) }
  finally { mediaChecking = false }
}
function sceneNow() {
  if (mediaPending) throw new Error('Wait for local image processing before saving or switching drawings. Cancel the image to restore the previous scene.')
  if (!api) throw new Error('Editor is not ready.')
  return validateScene({ elements: api.getSceneElementsIncludingDeleted(), appState: cleanAppState(api.getAppState()), files: api.getFiles() })
}
function snapshot(requestId) {
  clearTimeout(timer)
  try {
    if (mediaPending) { if (requestId) throw new Error('Wait for local image processing before switching drawings. Cancel the image to restore the previous scene.'); return }
    const scene = sceneNow()
    lastKey = JSON.stringify(scene); pendingInteraction = false
    send('snapshot', { scene, sequence: ++sequence, requestId })
  } catch (err) { error(err); if (requestId) send('response', { requestId, error: String(err.message) }) }
}
function dirty() {
  if (!initialized) return
  pendingInteraction = true
  send('dirty')
  clearTimeout(timer)
  timer = setTimeout(() => snapshot(), 250)
}
for (const event of ['pointerdown', 'keydown', 'paste', 'drop', 'change']) document.addEventListener(event, dirty, true)
// Embedded content is never navigable, including vendor help and scene links.
document.addEventListener('click', event => { if (event.target.closest?.('a')) { event.preventDefault(); event.stopPropagation() } }, true)
window.addEventListener('error', event => mediaFailed(event.error || event.message))
window.addEventListener('unhandledrejection', event => mediaFailed(event.reason))

function Editor({ scene }) {
  const [mode, setMode] = useState(theme)
  renderTheme = setMode
  return <Excalidraw initialData={{ ...scene, appState: { ...scene.appState, theme } }} theme={mode} langCode="en" aiEnabled={false}
    generateIdForFile={() => [...crypto.getRandomValues(new Uint8Array(20))].map(byte => byte.toString(16).padStart(2, '0')).join('')}
    excalidrawAPI={value => { api = value; initialized = true; send('mounted') }}
    onChange={(elements, appState, files) => {
      if (mediaPending && appState.errorMessage) mediaFailed(new Error(appState.errorMessage))
      else checkMedia(elements, files)
      // Locking input must never suppress already-started editor writes.
      if (!initialized) return
      const next = { elements, appState: cleanAppState(appState), files }
      const key = JSON.stringify(next)
      if (key !== lastKey || pendingInteraction) { lastKey = key; dirty() }
    }}
    onLinkOpen={(_, event) => event.preventDefault()}
    validateEmbeddable={() => false}
    UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: false, toggleTheme: false, saveAsImage: false }, tools: { image: true } }}>
    <MainMenu><MainMenu.Item onSelect={() => send('notice', { message: 'Use the Hermes toolbar to import or export. Links are preserved as inactive data. All drawing data stays on this device.' })}>Local-only drawing</MainMenu.Item></MainMenu>
  </Excalidraw>
}

window.addEventListener('message', async event => {
  const msg = event.data
  if (event.source !== parent || !msg || msg.channel !== CHANNEL || msg.token !== token || msg.documentId !== documentId) return
  try {
    if (msg.type === 'init' && !initialized) {
      const scene = validateScene(msg.scene)
      lastKey = JSON.stringify(scene); theme = msg.theme
      createRoot(document.getElementById('root')).render(<Editor scene={scene} />)
    } else if (msg.type === 'theme') { theme = msg.theme; renderTheme?.(theme) }
    else if (msg.type === 'saved' && api) {
      const files = api.getFiles(), elements = api.getSceneElementsIncludingDeleted()
      if (elements.some(el => el.type === 'image' && el.status === 'pending' && files[el.fileId])) api.updateScene({ elements: elements.map(el => el.type === 'image' && el.status === 'pending' && files[el.fileId] ? { ...el, status: 'saved' } : el) })
    }
    else if (msg.type === 'flush') { await settledFrames(); snapshot(msg.requestId) }
    else if (msg.type === 'lock') { setLocked(!!msg.locked); await settledFrames(); send('response', { requestId: msg.requestId }) }
    else if (msg.type === 'export') {
      const scene = msg.recovery && mediaPending && mediaRecovery ? mediaRecovery : sceneNow()
      if (msg.format === 'json') send('response', { requestId: msg.requestId, format: 'json', text: JSON.stringify({ type: 'excalidraw', version: 2, source: 'hermes-excalidraw', ...scene }, null, 2) })
      else {
        // Image exports must not turn inert scene links into active SVG anchors.
        const options = { ...scene, elements: scene.elements.map(el => el.link ? { ...el, link: null } : el), appState: { ...scene.appState, exportBackground: true, exportWithDarkMode: theme === 'dark' } }
        const blob = msg.format === 'png' ? await exportToBlob({ ...options, mimeType: 'image/png' }) : new Blob([(await exportToSvg({ ...options, exportEmbedScene: false, skipInliningFonts: true })).outerHTML], { type: 'image/svg+xml' })
        if (blob.size > MAX_BYTES) throw new Error('Image export exceeds 12 MiB.')
        send('response', { requestId: msg.requestId, format: msg.format, bytes: await blob.arrayBuffer() })
      }
    }
  } catch (err) { error(err); send('response', { requestId: msg.requestId, error: String(err.message) }) }
})
send('ready')
