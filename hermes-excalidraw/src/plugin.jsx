import React, { useEffect, useRef, useState } from 'react'
import { Button, SandboxedFrame, useTheme, host, PALETTE_AREA } from '@hermes/plugin-sdk'
import { CHANNEL, MAX_BYTES, acceptsMessage, download, openStore, parseScene, validateScene } from './core.mjs'

export const CSP = "default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; font-src data:; img-src data: blob:; media-src data: blob:; connect-src data: blob:; worker-src blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
const bootstrap = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><script>const p=new URLSearchParams(location.hash.slice(1));const token=p.get('token'),documentId=p.get('documentId');addEventListener('message',function boot(e){if(e.source!==parent||e.data?.channel!=='${CHANNEL}'||e.data?.type!=='boot'||e.data?.token!==token||e.data?.documentId!==documentId||typeof e.data.html!=='string')return;removeEventListener('message',boot);location.replace(URL.createObjectURL(new Blob([e.data.html],{type:'text/html'}))+'#'+p)});parent.postMessage({channel:'${CHANNEL}',type:'boot-ready',token,documentId},'*')</script>`
const bootUrl = 'data:text/html;base64,' + btoa(bootstrap)
let htmlCache
async function editorHtml() {
  if (!htmlCache) htmlCache = new Response(new Blob([Uint8Array.from(atob(__GUEST_GZIP__), c => c.charCodeAt(0))]).stream().pipeThrough(new DecompressionStream('gzip'))).text()
  return htmlCache
}
const css = `.hex{height:100%;min-height:0;min-width:0;display:flex;flex-direction:column;color:var(--ui-text-primary);font:inherit;font-size:12px}.hex-bar{display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:8px;border-bottom:1px solid var(--ui-stroke-secondary)}.hex-bar select{flex:1;min-width:110px;max-width:240px;padding:5px;color:var(--ui-text-primary);background:var(--ui-bg-secondary);border:1px solid var(--ui-stroke-secondary);border-radius:4px;font:inherit}.hex-editor{position:relative;flex:1;min-height:220px}.hex-editor iframe{position:absolute;inset:0;width:100%;height:100%;border:0}.hex-footer{display:flex;gap:10px;justify-content:space-between;padding:6px 10px;border-top:1px solid var(--ui-stroke-secondary);color:var(--ui-text-secondary)}.hex-error{padding:8px;color:var(--ui-text-primary);border-bottom:1px solid var(--ui-stroke-secondary);overflow-wrap:anywhere}.hex-empty{padding:24px;line-height:1.5}.hex button:focus-visible,.hex select:focus-visible{outline:2px solid var(--ui-accent);outline-offset:2px}`
class Boundary extends React.Component {
  state = { error: null }
  static getDerivedStateFromError(error) { return { error } }
  render() { return this.state.error ? <div role="alert">Excalidraw could not open. Saved documents are unchanged. Reopen the plugin to retry.</div> : this.props.children }
}
function Drawing({ ctx }) {
  const { resolvedMode } = useTheme()
  const [rows, setRows] = useState([]), [active, setActive] = useState(null), [status, setStatus] = useState('Opening local storage…')
  const [showInfo, setShowInfo] = useState(false), [processing, setProcessing] = useState(false)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [ready, setReady] = useState(false), [nonce, setNonce] = useState('')
  const frame = useRef(), fileInput = useRef(), store = useRef(), current = useRef(), token = useRef(''), theme = useRef(resolvedMode)
  const pending = useRef(new Map()), queue = useRef(Promise.resolve()), alive = useRef(true), readyRef = useRef(false), action = useRef(false)
  const savedSequence = useRef(0), savedVersion = useRef(0), lastSequence = useRef(0), dirty = useRef(0), media = useRef(false), mediaRecovery = useRef(null), fault = useRef(null), bootTimer = useRef(), initialized = useRef(false)
  theme.current = resolvedMode
  function send(type, extra = {}) { frame.current?.contentWindow?.postMessage({ channel: CHANNEL, token: token.current, documentId: current.current?.id, type, ...extra }, '*') }
  function fail(err) { if (alive.current) { setError(String(err?.message || err)); setStatus('Not saved'); } }
  function request(type, extra = {}) {
    return new Promise((resolve, reject) => {
      if (!readyRef.current) { reject(new Error('Editor is not ready.')); return }
      const requestId = crypto.randomUUID(), timer = setTimeout(() => { pending.current.delete(requestId); reject(new Error('The editor did not respond. Saved data is unchanged.')) }, 20000)
      pending.current.set(requestId, { resolve, reject, timer }); send(type, { ...extra, requestId })
    })
  }
  function settle(id, err, data) {
    const item = pending.current.get(id)
    if (!item) return
    pending.current.delete(id); clearTimeout(item.timer)
    err ? item.reject(err) : item.resolve(data)
  }
  async function refresh() { const all = await store.current.list(); if (alive.current) setRows(all); return all }
  function activate(row) {
    for (const entry of pending.current.values()) { clearTimeout(entry.timer); entry.reject(new Error('Drawing changed.')) }
    pending.current.clear()
    current.current = row; token.current = crypto.randomUUID(); dirty.current = 0; savedVersion.current = 0; savedSequence.current = 0; lastSequence.current = 0; media.current = false; mediaRecovery.current = null; setProcessing(false); fault.current = null; initialized.current = false
    readyRef.current = false; setReady(false); setActive(row); setNonce(token.current); setStatus('Opening drawing…'); setError('')
    ctx.storage.set('lastDocument', row.id)
    clearTimeout(bootTimer.current)
    bootTimer.current = setTimeout(() => { if (!readyRef.current) fail(new Error('Editor startup timed out. Choose another drawing or reopen the plugin.')) }, 30000)
  }
  async function flush() {
    if (!current.current) return
    if (!readyRef.current) { await queue.current; return }
    for (let attempt = 0; attempt < 3; attempt++) {
      await request('flush'); await queue.current
      if (fault.current) throw fault.current
      if (savedVersion.current === dirty.current) return
    }
    throw new Error('The drawing is still changing. Retry after local processing finishes.')
  }
  async function run(fn) {
    if (action.current) return
    action.current = true; setBusy(true)
    try {
      if (readyRef.current) await request('lock', { locked: true })
      await flush(); await fn()
    } catch (err) { fail(err) }
    finally { action.current = false; if (alive.current) setBusy(false); if (readyRef.current) send('lock', { locked: false }) }
  }
  const create = () => run(async () => { const row = await store.current.create(crypto.randomUUID(), `Drawing ${rows.length + 1}`, { elements: [], appState: {}, files: {} }); await refresh(); activate(row) })
  const switchTo = id => run(async () => { const row = (await store.current.list()).find(r => r.id === id); if (row) activate(row) })
  const exportFile = format => run(async () => {
    const msg = await request('export', { format })
    const blob = format === 'json' ? new Blob([msg.text], { type: 'application/json' }) : new Blob([msg.bytes], { type: format === 'png' ? 'image/png' : 'image/svg+xml' })
    download(blob, `${current.current.title.replace(/[^\w -]/g, '_')}.${format === 'json' ? 'excalidraw' : format}`)
  })
  const recovery = async () => { try { const msg = await request('export', { format: 'json', recovery: true }); download(new Blob([msg.text], { type: 'application/json' }), 'recovery.excalidraw') } catch (err) { fail(err) } }
  async function cancelImage() {
    if (action.current || !media.current || !mediaRecovery.current) return
    action.current = true; setBusy(true)
    try {
      if (readyRef.current) await request('lock', { locked: true })
      await queue.current
      if (!media.current) return
      const scene = validateScene(mediaRecovery.current), retainedFault = fault.current
      // A new guest discards late FileReader/decode callbacks from the old one.
      // Retain any save fault; cancelling media is not permission to overwrite.
      activate({ ...current.current, scene })
      fault.current = retainedFault; dirty.current = 1
      if (retainedFault) fail(new Error('Local save failed. Image cancelled; export a recovery copy before reopening.'))
      else setStatus('Restoring scene before image…')
    } catch (err) { fail(err) }
    finally { action.current = false; if (alive.current) setBusy(false); if (readyRef.current) send('lock', { locked: false }) }
  }
  async function importFile(event) {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return
    await run(async () => {
      if (file.size > MAX_BYTES) throw new Error('Import exceeds the 12 MiB limit.')
      const scene = parseScene(await file.text())
      const row = await store.current.create(crypto.randomUUID(), file.name.replace(/\.(excalidraw|json)$/i, '').slice(0,120) || 'Imported drawing', scene)
      await refresh(); activate(row)
    })
  }
  useEffect(() => {
    alive.current = true
    let disposed = false
    const listener = async event => {
      if (!acceptsMessage(event, frame.current?.contentWindow, token.current, current.current?.id)) return
      const msg = event.data
      if (msg.type === 'boot-ready') {
        try { const tok = token.current, html = await editorHtml(); if (tok === token.current && alive.current) send('boot', { html }) } catch (err) { fail(err) }
      } else if (msg.type === 'ready') { if (!initialized.current) { initialized.current = true; send('init', { scene: current.current.scene, theme: theme.current === 'dark' ? 'dark' : 'light' }) } }
      else if (msg.type === 'mounted') { readyRef.current = true; clearTimeout(bootTimer.current); setReady(true); if (fault.current) setStatus('Not saved'); else if (dirty.current === 0) setStatus('Saved locally'); else send('flush') }
      else if (msg.type === 'processing') {
        media.current = msg.pending === true; setProcessing(media.current)
        if (msg.recoveryScene) { try { mediaRecovery.current = validateScene(msg.recoveryScene) } catch (err) { fail(err); return } }
        if (!media.current) mediaRecovery.current = null
        setStatus(fault.current ? 'Not saved' : msg.failed ? 'Image processing failed' : media.current ? 'Processing local image…' : 'Unsaved changes…')
      }
      else if (msg.type === 'dirty') { dirty.current += 1; setStatus(fault.current ? 'Not saved' : media.current ? 'Processing local image…' : 'Unsaved changes…') }
      else if (msg.type === 'snapshot') {
        if (!Number.isSafeInteger(msg.sequence) || msg.sequence <= lastSequence.current || !msg.scene || JSON.stringify(msg.scene).length > MAX_BYTES) { settle(msg.requestId, new Error('Invalid editor save message.')); return }
        lastSequence.current = msg.sequence
        const requestedToken = token.current, documentId = current.current.id, version = dirty.current
        const task = queue.current.then(async () => {
          try {
            if (requestedToken !== token.current || documentId !== current.current?.id) throw new Error('Drawing changed before saving.')
            if (fault.current) throw fault.current
            setStatus(fault.current ? 'Not saved' : 'Saving…')
            const row = await store.current.save(documentId, validateScene(msg.scene), current.current.revision)
            current.current = row; savedSequence.current = msg.sequence; savedVersion.current = version
            send('saved', { sequence: msg.sequence })
            if (alive.current) { setStatus(fault.current ? 'Not saved' : media.current ? 'Processing local image…' : version === dirty.current ? 'Saved locally' : 'Unsaved changes…'); if (!media.current && !fault.current) setError('') }
            settle(msg.requestId, null, msg)
          } catch (err) { fault.current = err; fail(new Error('Local save failed or another window changed this drawing. Export a recovery copy before reopening.')); settle(msg.requestId, err) }
        })
        queue.current = task.catch(fail)
      } else if (msg.type === 'response') {
        if (msg.bytes && (!(msg.bytes instanceof ArrayBuffer) || msg.bytes.byteLength > MAX_BYTES)) return
        if (msg.text && (typeof msg.text !== 'string' || msg.text.length > MAX_BYTES)) return
        settle(msg.requestId, msg.error ? new Error(msg.error) : null, msg)
      } else if (msg.type === 'error') { fail(new Error(msg.message || 'The editor failed.')) }
      else if (msg.type === 'notice') { host.notify({ kind: 'info', message: String(msg.message).slice(0,400) }) }
    }
    window.addEventListener('message', listener)
    const hide = () => { if (document.visibilityState === 'hidden' && readyRef.current) request('flush').catch(fail) }
    document.addEventListener('visibilitychange', hide)
    openStore().then(async db => {
      if (disposed) { db.close(); return }
      store.current = db; const all = await refresh(), last = ctx.storage.get('lastDocument', '')
      const row = all.find(r => r.id === last) || all[0]
      if (row) activate(row); else setStatus('Local storage ready')
    }).catch(fail)
    return () => { disposed = true; alive.current = false; clearTimeout(bootTimer.current); window.removeEventListener('message', listener); document.removeEventListener('visibilitychange', hide); for (const item of pending.current.values()) { clearTimeout(item.timer); item.reject(new Error('Editor closed.')) }; pending.current.clear(); queue.current.finally(() => store.current?.close()) }
  }, [])
  useEffect(() => { if (active) send('theme', { theme: resolvedMode === 'dark' ? 'dark' : 'light' }) }, [resolvedMode, active])
  return <section className="hex" aria-label="Excalidraw"><style>{css}</style>
    <div className="hex-bar"><select aria-label="Drawing" disabled={busy || !rows.length} value={active?.id || ''} onChange={e => switchTo(e.target.value)}>{rows.map(row => <option key={row.id} value={row.id}>{row.title}</option>)}</select>
    <Button size="sm" disabled={busy || !store.current} onClick={create}>New drawing</Button>
    <Button size="sm" variant="outline" disabled={busy || !store.current} onClick={() => fileInput.current.click()}>Import</Button>
    <Button size="sm" variant="outline" disabled={busy || !ready} onClick={() => exportFile('json')}>Export scene</Button>
    <Button size="sm" variant="outline" disabled={busy || !ready} onClick={() => exportFile('png')}>PNG</Button>
    <Button size="sm" variant="outline" disabled={busy || !ready} onClick={() => exportFile('svg')}>SVG</Button>
    <Button size="sm" variant="outline" aria-expanded={showInfo} onClick={() => setShowInfo(value => !value)}>About</Button></div>
    <input ref={fileInput} type="file" accept=".excalidraw,.json,application/json" aria-label="Import Excalidraw file" hidden onChange={importFile} />
    {showInfo && <div className="hex-empty" role="note"><strong>Local Excalidraw 0.18.1</strong><p>MIT licensed. No account, subscription or license key. No collaboration, cloud, AI or remote media. Links are preserved in scene backups as inactive text, never opened here, and omitted from image exports. Drawings and raster images stay in this Desktop app's local storage, unencrypted. Export scene backups before clearing app data, changing installations or uninstalling.</p><p>25 font files are bundled. The Xiaolai CJK pack is omitted. CJK and other missing glyphs depend on installed system fonts and may not render. SVG exports do not embed fonts, so text can look different on another device. Use PNG for a fixed appearance.</p><p>Local limits: 12 MiB per scene, 20,000 elements and 100 images. Wait for Saved locally before closing. Third-party copyright and license text is installed alongside plugin.js as THIRD_PARTY_NOTICES.md.</p></div>}
    {error && <div role="alert" className="hex-error">{error} {ready && <Button size="sm" variant="outline" onClick={recovery}>Export recovery</Button>}</div>}
    {processing && <div className="hex-error" role="note">Recovery exports the scene before the image started. Cancelling discards the unfinished image and any edits since it started. <Button size="sm" variant="outline" disabled={busy} onClick={cancelImage}>Cancel image and restore previous scene</Button>{!error && <Button size="sm" variant="outline" onClick={recovery}>Export recovery</Button>}</div>}
    <div className="hex-editor">{active ? <SandboxedFrame key={nonce} ref={frame} title="Excalidraw editor" src={`${bootUrl}#token=${nonce}&documentId=${active.id}`} sandbox="allow-scripts" style={{ width: '100%', height: '100%' }} /> : <div className="hex-empty"><h2>Draw locally in Hermes</h2><p>Create a drawing or import an Excalidraw file. No account, collaboration server or cloud storage.</p></div>}</div>
    <div className="hex-footer"><span role="status" aria-live="polite">{status}</span><span title="Wait for Saved locally before closing. Local data is not encrypted; export backups for important drawings.">Local only · wait for Saved locally before closing</span></div>
  </section>
}
export default { id: 'hermes-excalidraw', name: 'Excalidraw', register(ctx) {
  let closeWorkspace
  const open = () => { closeWorkspace = host.openWorkspace('hermes-excalidraw', { title: 'Excalidraw', minWidth: 360, render: () => <Boundary><Drawing ctx={ctx} /></Boundary> }) }
  ctx.register({ id: 'open', area: PALETTE_AREA, data: { id: 'excalidraw.open', label: 'Open Excalidraw', onSelect: open } })
  ctx.register({ id: 'status', area: 'statusBar.right', order: 126, render: () => <button type="button" style={{ font: 'inherit', fontSize: 12, padding: '0 6px', color: 'var(--ui-text-secondary)' }} onClick={open}>Excalidraw</button> })
  ctx.onDispose(() => closeWorkspace?.())
} }
