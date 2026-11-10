import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

export function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex') }
export async function sourceFingerprint() {
  const files = ['package.json', 'package-lock.json', 'playwright.config.mjs', 'LICENSE']
  async function visit(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const filename = path.join(dir, entry.name)
      if (entry.isDirectory()) await visit(filename)
      else if (entry.isFile()) files.push(filename)
      else throw new Error(`Unexpected non-file in verified source: ${filename}`)
    }
  }
  for (const dir of ['src', 'scripts', 'tests', 'licenses']) await visit(dir)
  const hash = createHash('sha256')
  for (const filename of files.sort()) { hash.update(filename + '\0'); hash.update(await readFile(filename)); hash.update('\0') }
  return hash.digest('hex')
}
