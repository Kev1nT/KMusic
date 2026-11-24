import fs from 'node:fs'
import { UA } from '../util/http.js'
import { resizeCover } from '../util/covers.js'

const SIZES = [1500, 1200, 800, 500, 300]

export async function fetchBestCover(url: string, dest: string, preferred: number): Promise<string | null> {
  if (!url) return null
  const chain = [preferred, ...SIZES.filter((s) => s < preferred)]
  for (const size of chain) {
    const candidate = resizeCover(url, size)
    try {
      const res = await fetch(candidate, { headers: { 'User-Agent': UA } })
      if (!res.ok) continue
      const type = res.headers.get('content-type') || ''
      const buf = Buffer.from(await res.arrayBuffer())
      if (!type.startsWith('image/') || buf.length < 4000) continue
      await fs.promises.writeFile(dest, buf)
      return dest
    } catch {
      continue
    }
  }
  return null
}
