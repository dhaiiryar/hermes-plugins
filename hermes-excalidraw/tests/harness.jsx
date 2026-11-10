import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import plugin from '../dist/plugin.js'
import { workspace, subscribe } from './sdk.jsx'
const contributions=[]
const ctx={ register: value=>contributions.push(value), onDispose: ()=>{}, storage: { get: (key,fallback)=>JSON.parse(localStorage.getItem('test.excalidraw.'+key)||'null')??fallback, set: (key,value)=>localStorage.setItem('test.excalidraw.'+key,JSON.stringify(value)) } }
plugin.register(ctx)
function App() {
  const [,rerender]=useState(0)
  subscribe(()=>rerender(v=>v+1))
  const page=workspace()
  return <><nav>{contributions.filter(v=>v.render).map(v=><React.Fragment key={v.id}>{v.render()}</React.Fragment>)}</nav><main id="workspace">{page?.render()}</main></>
}
createRoot(document.getElementById('root')).render(<App />)
