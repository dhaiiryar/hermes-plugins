import React, { forwardRef, useSyncExternalStore } from 'react'
export const PALETTE_AREA = 'palette'
let work, mode='light', listener=()=>{}
export const host = { openWorkspace: (id, value) => { work=value; listener(); return ()=>{work=null;listener()} }, notify: ()=>{} }
export function subscribe(fn) { listener=fn; return ()=>{listener=()=>{}} }
export function workspace() { return work }
export function useTheme() { return { resolvedMode: useSyncExternalStore(subscribe,()=>mode) } }
window.setTestTheme = value => { mode=value; listener() }
export const Button = ({ size,variant,...props }) => <button {...props} />
export const SandboxedFrame = forwardRef((props,ref) => <iframe {...props} ref={ref} sandbox="allow-scripts" referrerPolicy="no-referrer" />)
