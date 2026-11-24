// 解析 Apple Music 的逐字歌词 TTML（wrapper /lyrics 返回）为可渲染结构。
// 结构示例：<p begin="16.187" end="19.922"><span begin="16.187" end="16.427">We</span> ...</p>
export interface TtmlWord {
  text: string
  startMs: number
  endMs: number
}
export interface TtmlLine {
  startMs: number
  endMs: number
  text: string
  words: TtmlWord[]
}

function toMs(raw: string | null | undefined): number {
  if (!raw) return 0
  const s = String(raw).trim()
  if (!s) return 0
  if (s.includes(':')) {
    const parts = s.split(':').map((x) => Number(x))
    let sec = 0
    for (const p of parts) sec = sec * 60 + (Number.isFinite(p) ? p : 0)
    return Math.round(sec * 1000)
  }
  const n = Number(s)
  return Number.isFinite(n) ? Math.round(n * 1000) : 0
}

export function parseAppleTTML(ttml: string): TtmlLine[] {
  if (!ttml || typeof DOMParser === 'undefined') return []
  let doc: Document
  try {
    doc = new DOMParser().parseFromString(ttml, 'text/xml')
  } catch {
    return []
  }
  const ps = Array.from(doc.getElementsByTagName('p'))
  const lines: TtmlLine[] = []
  for (const p of ps) {
    const startMs = toMs(p.getAttribute('begin'))
    const endMs = toMs(p.getAttribute('end'))
    const words: TtmlWord[] = []
    // 只取直接子 span（逐字），跳过翻译/背景等 role 标注的节点
    for (const node of Array.from(p.childNodes)) {
      if (node.nodeType === 3) {
        const txt = (node.textContent || '').trim()
        if (txt) words.push({ text: txt, startMs, endMs })
      } else if (node.nodeType === 1) {
        const el = node as Element
        const role = el.getAttribute('ttm:role') || el.getAttribute('role') || ''
        if (/translation|bg|background/i.test(role)) continue
        const txt = (el.textContent || '').trim()
        if (!txt) continue
        const wb = el.getAttribute('begin')
        const we = el.getAttribute('end')
        words.push({ text: txt, startMs: wb ? toMs(wb) : startMs, endMs: we ? toMs(we) : endMs })
      }
    }
    if (!words.length) continue
    const text = words.map((w) => w.text).join(' ')
    lines.push({ startMs, endMs: endMs || words[words.length - 1].endMs, text, words })
  }
  lines.sort((a, b) => a.startMs - b.startMs)
  return lines
}

export function activeLineIndex(lines: TtmlLine[], ms: number): number {
  if (!lines.length) return -1
  let idx = -1
  for (let i = 0; i < lines.length; i++) {
    if (ms >= lines[i].startMs) idx = i
    else break
  }
  return idx
}
