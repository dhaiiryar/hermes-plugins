// Build-time only. These text files are vendored so normal builds stay offline.
import { mkdir, writeFile, access } from 'node:fs/promises'
const sources={
  Excalidraw:'https://raw.githubusercontent.com/excalidraw/excalidraw/v0.18.1/LICENSE',
  Assistant:'https://raw.githubusercontent.com/google/fonts/main/ofl/assistant/OFL.txt',
  Cascadia:'https://raw.githubusercontent.com/microsoft/cascadia-code/main/LICENSE',
  Excalifont:'https://raw.githubusercontent.com/excalidraw/excalidraw/v0.18.1/packages/excalidraw/fonts/Excalifont/index.ts',
  ComicShanns:'https://raw.githubusercontent.com/excalidraw/excalidraw/v0.18.1/packages/excalidraw/fonts/ComicShanns/index.ts',
  Liberation:'https://raw.githubusercontent.com/liberationfonts/liberation-fonts/main/LICENSE',
  Lilita:'https://raw.githubusercontent.com/google/fonts/main/ofl/lilitaone/OFL.txt',
  Nunito:'https://raw.githubusercontent.com/google/fonts/main/ofl/nunito/OFL.txt',
  Virgil:'https://raw.githubusercontent.com/excalidraw/virgil/main/LICENSE.md',
  Radix:'https://raw.githubusercontent.com/radix-ui/primitives/main/LICENSE',
  ReactRemoveScrollBar:'https://raw.githubusercontent.com/theKashey/react-remove-scroll-bar/master/LICENSE',
  Fuzzy:'https://raw.githubusercontent.com/mattyork/fuzzy/master/LICENSE-MIT',
}
await mkdir('licenses',{recursive:true})
for(const [name,url] of Object.entries(sources)){
  try { await access(`licenses/${name}.txt`); console.log('Preserved vendored license:',name); continue } catch(err) { if(err.code!=='ENOENT')throw err }
  const response=await fetch(url);if(!response.ok)throw new Error(`${name}: ${response.status}`)
  const text=await response.text()
  if(!/license|permission is hereby granted/i.test(text))throw new Error(`${name}: missing license text`)
  await writeFile(`licenses/${name}.txt`,`Source: ${url}\n\n${text}`,{flag:'wx'})
  console.log('Vendored license:',name)
}
