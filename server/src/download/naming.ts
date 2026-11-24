import path from 'node:path'

export const DEFAULT_TEMPLATE = '{artist}/{album}/{track:02d} - {title}'

export interface NamingData {
  artist: string
  artists: string
  album: string
  title: string
  track?: number
  year?: string
  source?: string
  ext?: string
}

const ILLEGAL = /[\\/:*?"<>|\u0000-\u001f]/g

export function sanitizeSegment(input: string, maxLength = 120): string {
  let s = (input || '').normalize('NFC').replace(ILLEGAL, '_').replace(/\s+/g, ' ').trim()
  s = s.replace(/^[.\s]+|[.\s]+$/g, '')
  if (!s) s = '未知'
  if (s.length > maxLength) s = s.slice(0, maxLength).trim()
  return s
}

export function renderTemplate(template: string, data: NamingData): string {
  const values: Record<string, string> = {
    artist: sanitizeSegment(data.artist || '未知歌手'),
    artists: sanitizeSegment(data.artists || data.artist || '未知歌手'),
    album: sanitizeSegment(data.album || '未知专辑'),
    title: sanitizeSegment(data.title || '未知歌曲'),
    year: sanitizeSegment(data.year || ''),
    source: sanitizeSegment(data.source || ''),
    ext: data.ext || 'flac',
  }
  const track = Number(data.track || 0)

  let out = template
  out = out.replace(/\{(\w+):0(\d)d\}/g, (_m, key: string, width: string) => {
    if (key === 'track') return String(track).padStart(Number(width), '0')
    return values[key] ?? ''
  })
  out = out.replace(/\{(\w+)\}/g, (_m, key: string) => values[key] ?? '')
  out = out.replace(/\{ext\}/g, values.ext)

  const segments = out
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => sanitizeSegment(s, 150))
  return segments.join(path.sep)
}

export function resolveInside(root: string, relative: string): string {
  const target = path.resolve(root, relative)
  const normalizedRoot = path.resolve(root)
  if (target !== normalizedRoot && !target.startsWith(normalizedRoot + path.sep)) {
    throw new Error('非法的目标路径')
  }
  return target
}

export function xmlEscape(input: string): string {
  return String(input || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
