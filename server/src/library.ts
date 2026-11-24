import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { db, now } from './db.js'
import { logEvent } from './logger.js'

const exec = promisify(execFile)
const AUDIO_EXT = new Set(['.flac', '.mp3', '.m4a', '.ape', '.wav', '.ogg', '.aac', '.wma', '.dsf'])

export interface LibraryFile {
  path: string
  root: string
  title: string
  artist: string
  album: string
  duration_ms: number
  size: number
  ext: string
}

async function walk(dir: string, out: string[]) {
  let entries: fs.Dirent[]
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.')) continue
      await walk(full, out)
    } else if (AUDIO_EXT.has(path.extname(entry.name).toLowerCase())) {
      out.push(full)
    }
  }
}

async function probeTags(file: string): Promise<{ title?: string; artist?: string; album?: string; duration: number; bitrate: number; codec: string }> {
  try {
    const { stdout } = await exec(
      'ffprobe',
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file],
      { maxBuffer: 2 * 1024 * 1024, timeout: 15_000 },
    )
    const data = JSON.parse(stdout)
    const tags: Record<string, string> = {}
    for (const [k, v] of Object.entries(data?.format?.tags || {})) tags[k.toLowerCase()] = String(v)
    const audio = (data?.streams || []).find((stream: any) => stream.codec_type === 'audio') || {}
    return {
      title: tags.title || tags.TIT2,
      artist: tags.artist || tags.album_artist || tags.TPE1,
      album: tags.album || tags.TALB,
      duration: Math.round(Number(data?.format?.duration || 0) * 1000),
      bitrate: Number(audio.bit_rate || data?.format?.bit_rate || 0),
      codec: String(audio.codec_name || ''),
    }
  } catch {
    return { duration: 0, bitrate: 0, codec: '' }
  }
}

function fallbackFromPath(root: string, file: string) {
  const rel = path.relative(root, file)
  const parts = rel.split(path.sep)
  const base = path.basename(file, path.extname(file)).replace(/^\d+[\s.\-_]+/, '').trim()
  const album = parts.length >= 2 ? parts[parts.length - 2] : ''
  const artist = parts.length >= 3 ? parts[parts.length - 3] : ''
  return { title: base, album, artist }
}

export async function scanLibrary(roots: string[]) {
  const uniqueRoots = [...new Set(roots.filter(Boolean).map((r) => path.resolve(r)))]
  let added = 0
  let updated = 0
  let removed = 0
  let total = 0

  const upsert = db.prepare(
    `INSERT INTO library_files (path, root, provider, title, artist, album, duration_ms, size, mtime, ext, bitrate, codec, scanned_at)
     VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(path) DO UPDATE SET
       root = excluded.root,
       title = excluded.title,
       artist = excluded.artist,
       album = excluded.album,
       duration_ms = excluded.duration_ms,
       size = excluded.size,
       mtime = excluded.mtime,
       ext = excluded.ext,
       bitrate = excluded.bitrate,
       codec = excluded.codec,
       scanned_at = excluded.scanned_at`,
  )
  const getExisting = db.prepare('SELECT size, mtime FROM library_files WHERE path = ?')

  for (const root of uniqueRoots) {
    if (!fs.existsSync(root)) continue
    const files: string[] = []
    await walk(root, files)
    total += files.length
    const seen = new Set<string>()

    for (const file of files) {
      seen.add(file)
      let stat: fs.Stats
      try {
        stat = await fs.promises.stat(file)
      } catch {
        continue
      }
      const existing = getExisting.get(file) as any
      if (existing && Number(existing.size) === stat.size && Number(existing.mtime) === Math.floor(stat.mtimeMs)) {
        continue
      }
      const probed = await probeTags(file)
      const fallback = fallbackFromPath(root, file)
      const title = (probed.title || fallback.title || path.basename(file)).trim()
      const artist = (probed.artist || fallback.artist || '').trim()
      const album = (probed.album || fallback.album || '').trim()
      upsert.run(
        file,
        root,
        title,
        artist,
        album,
        probed.duration || 0,
        stat.size,
        Math.floor(stat.mtimeMs),
        path.extname(file).toLowerCase().replace('.', ''),
        probed.bitrate || 0,
        probed.codec || '',
        now(),
      )
      if (existing) updated += 1
      else added += 1
    }

    const rows = db.prepare('SELECT path FROM library_files WHERE root = ?').all(root) as any[]
    for (const row of rows) {
      if (!seen.has(row.path)) {
        db.prepare('DELETE FROM library_files WHERE path = ?').run(row.path)
        removed += 1
      }
    }
  }

  logEvent('info', '媒体库', '扫描完成', `新增 ${added} · 更新 ${updated} · 移除 ${removed} · 共 ${total}`)
  return { roots: uniqueRoots, total, added, updated, removed }
}

const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[\s\-_·・.,，。'’"“”()（）[\]【】]/g, '')
    .trim()

export function findExistingFile(title: string, artists: string[]): { path: string; title: string; artist: string } | null {
  const t = normalize(title)
  if (!t) return null
  const rows = db.prepare('SELECT path, title, artist FROM library_files WHERE lower(title) = lower(?) LIMIT 20').all(title) as any[]
  if (!rows.length) return null
  const wanted = artists.map(normalize).filter(Boolean)
  for (const row of rows) {
    if (!wanted.length) return row
    const existing = normalize(String(row.artist || ''))
    if (wanted.some((w) => existing.includes(w) || w.includes(existing))) return row
  }
  return null
}

export function listLibraryFiles(): any[] {
  return db.prepare('SELECT * FROM library_files ORDER BY artist, album, title').all() as any[]
}
