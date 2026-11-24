import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { isUtf8 } from 'node:buffer'
import { createRequire } from 'node:module'
import iconv from 'iconv-lite'
import { db, now } from './db.js'
import { config } from './config.js'
import { getSettings } from './settings.js'
import { logEvent } from './logger.js'
import { getProvider } from './providers/registry.js'
import { fetchBestCover } from './download/cover.js'
import { writeAlbumNfo } from './download/tagger.js'

const exec = promisify(execFile)
const AUDIO_EXT = new Set(['.flac', '.mp3', '.m4a', '.ape', '.wav', '.ogg', '.aac', '.wma', '.dsf'])

export function allowedRoots(): string[] {
  const roots = new Set<string>()
  const settings = getSettings()
  if (settings.libraryPath) roots.add(path.resolve(settings.libraryPath))
  const accounts = db.prepare("SELECT library_path FROM accounts WHERE library_path <> ''").all() as any[]
  for (const row of accounts) roots.add(path.resolve(row.library_path))
  return [...roots]
}

export function rootFor(input: string): { abs: string; root: string } {
  const abs = path.resolve(input)
  const roots = allowedRoots()
  const root = roots.find((candidate) => abs === candidate || abs.startsWith(candidate + path.sep))
  if (!root) throw new Error('路径不在媒体库范围内')
  return { abs, root }
}

function sortEntries(entries: string[]) {
  return entries.sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }))
}

export async function listDirectory(input: string) {
  const { abs, root } = rootFor(input)
  const stat = await fs.promises.stat(abs)
  if (!stat.isDirectory()) throw new Error('不是目录')
  const entries = await fs.promises.readdir(abs, { withFileTypes: true })
  const dirs: any[] = []
  const files: any[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const full = path.join(abs, entry.name)
    try {
      const info = await fs.promises.stat(full)
      if (info.isDirectory()) dirs.push({ name: entry.name, path: full })
      else if (info.isFile()) {
        files.push({
          name: entry.name,
          path: full,
          size: info.size,
          mtime: info.mtimeMs,
          ext: path.extname(entry.name).toLowerCase().replace('.', ''),
          isAudio: AUDIO_EXT.has(path.extname(entry.name).toLowerCase()),
        })
      }
    } catch {
      /* skip unreadable */
    }
  }
  sortEntries(dirs.map((d) => d.name))
  dirs.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }))
  files.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }))
  return { path: abs, root, parent: abs === root ? null : path.dirname(abs), dirs, files }
}

export async function renameIndexPath(oldPath: string, newPath: string) {
  const rows = db.prepare('SELECT id, path FROM library_files').all() as any[]
  const update = db.prepare('UPDATE library_files SET path = ? WHERE id = ?')
  for (const row of rows) {
    if (row.path === oldPath || row.path.startsWith(oldPath + path.sep)) {
      update.run(newPath + row.path.slice(oldPath.length), row.id)
    }
  }
}

function uniquePath(target: string): string {
  if (!fs.existsSync(target)) return target
  const dir = path.dirname(target)
  const ext = path.extname(target)
  const base = path.basename(target, ext)
  for (let i = 2; i < 1000; i++) {
    const candidate = path.join(dir, `${base} (${i})${ext}`)
    if (!fs.existsSync(candidate)) return candidate
  }
  throw new Error('同名文件过多')
}

export async function renameEntry(input: string, newName: string) {
  const { abs } = rootFor(input)
  const clean = newName.trim()
  if (!clean || clean.includes('/') || clean.includes('\\') || clean === '.' || clean === '..') throw new Error('名称不合法')
  const target = path.join(path.dirname(abs), clean)
  if (target === abs) return { path: abs }
  if (fs.existsSync(target)) throw new Error('目标名称已存在')
  await fs.promises.rename(abs, target)
  await renameIndexPath(abs, target)
  return { path: target }
}

export async function copyEntries(inputs: string[], destDir: string) {
  const { abs: dest, root } = rootFor(destDir)
  const info = await fs.promises.stat(dest)
  if (!info.isDirectory()) throw new Error('目标不是目录')
  const copied: string[] = []
  for (const input of inputs) {
    const { abs } = rootFor(input)
    const target = uniquePath(path.join(dest, path.basename(abs)))
    await fs.promises.cp(abs, target, { recursive: true, errorOnExist: true })
    copied.push(target)
  }
  return { copied, dest, root }
}

export async function moveEntries(inputs: string[], destDir: string) {
  const { abs: dest, root } = rootFor(destDir)
  const info = await fs.promises.stat(dest)
  if (!info.isDirectory()) throw new Error('目标不是目录')
  const moved: string[] = []
  for (const input of inputs) {
    const { abs } = rootFor(input)
    const target = uniquePath(path.join(dest, path.basename(abs)))
    try {
      await fs.promises.rename(abs, target)
    } catch (err: any) {
      if (err?.code !== 'EXDEV') throw err
      await fs.promises.cp(abs, target, { recursive: true, errorOnExist: true })
      await fs.promises.rm(abs, { recursive: true, force: true })
    }
    await renameIndexPath(abs, target)
    moved.push(target)
  }
  return { moved, dest, root }
}

export async function deleteEntries(inputs: string[], mode: 'trash' | 'permanent') {
  const deleted: string[] = []
  const errors: { path: string; error: string }[] = []
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const trashDir = path.join(config.dataDir, 'trash', stamp)

  for (const input of inputs) {
    try {
      const { abs, root } = rootFor(input)
      if (abs === root) throw new Error('不能删除媒体库根目录')
      if (mode === 'permanent') {
        await fs.promises.rm(abs, { recursive: true, force: true })
      } else {
        const safeRoot = root.replace(/^[/\\]+/, '').replace(/[/\\]+/g, '_')
        const rel = path.relative(root, abs)
        const dest = path.join(trashDir, safeRoot, rel)
        await fs.promises.mkdir(path.dirname(dest), { recursive: true })
        try {
          await fs.promises.rename(abs, dest)
        } catch (err: any) {
          if (err?.code !== 'EXDEV') throw err
          await fs.promises.cp(abs, dest, { recursive: true, errorOnExist: true })
          await fs.promises.rm(abs, { recursive: true, force: true })
        }
      }
      const rows = db.prepare('SELECT id, path FROM library_files').all() as any[]
      const remove = db.prepare('DELETE FROM library_files WHERE id = ?')
      for (const row of rows) if (row.path === abs || row.path.startsWith(abs + path.sep)) remove.run(row.id)
      deleted.push(abs)
    } catch (err) {
      errors.push({ path: input, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return { deleted: deleted.length, paths: deleted, errors, trashDir: mode === 'trash' ? trashDir : undefined }
}

export async function mkdirEntry(parent: string, name: string) {
  const { abs } = rootFor(parent)
  const clean = name.trim()
  if (!clean || clean.includes('/') || clean.includes('\\') || clean === '.' || clean === '..') throw new Error('名称不合法')
  const target = path.join(abs, clean)
  if (fs.existsSync(target)) throw new Error('目录已存在')
  await fs.promises.mkdir(target)
  return { path: target }
}

export async function readTags(input: string) {
  const { abs } = rootFor(input)
  const stat = await fs.promises.stat(abs)
  if (!stat.isFile()) throw new Error('不是文件')
  const { stdout } = await exec('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', abs], {
    maxBuffer: 4 * 1024 * 1024,
    timeout: 15_000,
  })
  const data = JSON.parse(stdout)
  const tags: Record<string, string> = {}
  for (const [k, v] of Object.entries(data?.format?.tags || {})) tags[k.toLowerCase()] = String(v)
  const audio = (data?.streams || []).find((stream: any) => stream.codec_type === 'audio') || {}
  const hasEmbeddedCover = (data?.streams || []).some(
    (stream: any) => stream.codec_type === 'video' && stream.disposition?.attached_pic === 1,
  )
  const dir = path.dirname(abs)
  const base = path.basename(abs, path.extname(abs))
  const coverNames = ['cover.jpg', 'album.jpg', 'folder.jpg', 'artist.jpg']
  const coverPath = coverNames.map((name) => path.join(dir, name)).find((file) => fs.existsSync(file)) || null
  const lyricPath = fs.existsSync(path.join(dir, `${base}.lrc`)) ? path.join(dir, `${base}.lrc`) : null
  const nfoPath = fs.existsSync(path.join(dir, 'album.nfo')) ? path.join(dir, 'album.nfo') : null
  return {
    path: abs,
    tags: {
      title: tags.title || tags.TIT2 || '',
      artist: tags.artist || tags.album_artist || tags.TPE1 || '',
      album: tags.album || tags.TALB || '',
      year: tags.date || tags.year || tags.TDRC || '',
      track: tags.track || tags.TRCK || '',
    },
    durationMs: Math.round(Number(data?.format?.duration || 0) * 1000),
    bitrate: Number(audio.bit_rate || data?.format?.bit_rate || 0),
    codec: String(audio.codec_name || ''),
    hasEmbeddedCover,
    coverPath,
    lyricPath,
    nfoPath,
  }
}

export async function writeTags(input: string, patch: Record<string, string>) {
  const { abs } = rootFor(input)
  const ext = path.extname(abs)
  const temp = path.join(path.dirname(abs), `.kmusic-tags-${Date.now()}${ext}`)
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', abs, '-map', '0', '-c', 'copy']
  const mapping: Record<string, string> = {
    title: 'title',
    artist: 'artist',
    album: 'album',
    year: 'date',
    track: 'track',
  }
  for (const [key, value] of Object.entries(patch)) {
    if (mapping[key] && value !== undefined) args.push('-metadata', `${mapping[key]}=${value}`)
  }
  args.push(temp)
  await exec('ffmpeg', args, { maxBuffer: 8 * 1024 * 1024, timeout: 60_000 })
  await fs.promises.rename(temp, abs)
  return readTags(abs)
}

async function walkAudio(dir: string, out: string[]) {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) await walkAudio(full, out)
    else if (AUDIO_EXT.has(path.extname(entry.name).toLowerCase())) out.push(full)
  }
}

export interface MissingChecks {
  tags?: boolean
  lyric?: boolean
  cover?: boolean
  nfo?: boolean
}

export async function scanMissing(input: string, checks: MissingChecks = {}) {
  const { abs, root } = rootFor(input)
  const stat = await fs.promises.stat(abs)
  const files: string[] = []
  if (stat.isDirectory()) await walkAudio(abs, files)
  else if (AUDIO_EXT.has(path.extname(abs).toLowerCase())) files.push(abs)
  const items: any[] = []
  for (const file of files) {
    const info = await readTags(file)
    const want = { tags: checks.tags !== false, lyric: checks.lyric !== false, cover: checks.cover !== false, nfo: checks.nfo !== false }
    const missing: string[] = []
    if (want.tags) {
      if (!info.tags.title) missing.push('title')
      if (!info.tags.artist) missing.push('artist')
      if (!info.tags.album) missing.push('album')
      if (!info.tags.year) missing.push('year')
    }
    if (want.lyric && !info.lyricPath) missing.push('lyric')
    if (want.cover && !info.coverPath && !info.hasEmbeddedCover) missing.push('cover')
    if (want.nfo && !info.nfoPath) missing.push('nfo')
    if (missing.length) items.push({ path: file, title: info.tags.title || path.basename(file), artist: info.tags.artist, missing })
  }
  return { root, scanned: files.length, missing: items.length, items }
}

function norm(value: string) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

function changesParts(parts: string[], changed: boolean, providerId: string): string {
  if (!changed) return '无需补充（已完整）'
  const via = providerId === 'apple' ? 'Apple' : providerId === 'netease' ? '网易云' : 'QQ'
  return `已补充 ${parts.length ? parts.join(' / ') : '内容'}（匹配来源 ${via}）`
}

async function findTrack(title: string, artist: string) {
  const query = `${title} ${artist}`.trim()
  for (const providerId of ['qq', 'netease', 'apple']) {
    try {
      const tracks = await getProvider(providerId).search(query, 1)
      // 必须标题对得上才采纳，避免搜不准时补错封面/标签
      const sameTitle = tracks.filter((track) => norm(track.title) === norm(title))
      const match =
        sameTitle.find(
          (track) =>
            !artist ||
            track.artists.some((a) => {
              const na = norm(a)
              const ni = norm(artist)
              return na === ni || na.includes(ni) || ni.includes(na)
            }),
        ) || sameTitle[0]
      if (match) return { providerId, track: match }
    } catch {
      /* try next provider */
    }
  }
  return null
}

export async function fixMissing(paths: string[], checks: MissingChecks = {}) {
  const settings = getSettings()
  let fixed = 0
  const errors: { path: string; error: string }[] = []
  for (const input of paths) {
    try {
      const info = await readTags(input)
      const title = info.tags.title || path.basename(input, path.extname(input)).replace(/^\d+[\s.\-_]+/, '')
      const artist = info.tags.artist || ''
      const match = await findTrack(title, artist)
      if (!match) throw new Error('未找到匹配歌曲')
      const track = match.track
      const provider = getProvider(match.providerId)
      const dir = path.dirname(input)
      const base = path.basename(input, path.extname(input))
      const want = { tags: checks.tags !== false, lyric: checks.lyric !== false, cover: checks.cover !== false, nfo: checks.nfo !== false }
      let changed = false
      const patch: Record<string, string> = {}
      if (want.tags) {
        if (!info.tags.title) patch.title = track.title
        if (!info.tags.artist) patch.artist = track.artists.join(' / ')
        if (!info.tags.album) patch.album = track.album
        if (!info.tags.year && track.year) patch.year = track.year
      }
      if (Object.keys(patch).length) {
        await writeTags(input, patch)
        changed = true
      }
      if (want.lyric && !info.lyricPath) {
        const lyric = await provider.lyric(track).catch(() => null)
        if (lyric) {
          await fs.promises.writeFile(path.join(dir, `${base}.lrc`), lyric, 'utf8')
          changed = true
        }
      }
      if (want.cover && !info.coverPath && !info.hasEmbeddedCover) {
        const coverDest = path.join(dir, 'cover.jpg')
        const got = await fetchBestCover(track.cover, coverDest, settings.coverSize)
        if (got) changed = true
      }
      if (want.nfo && !info.nfoPath) {
        writeAlbumNfo(dir, {
          album: track.album || info.tags.album || '未知专辑',
          artists: track.artists,
          year: track.year,
          trackNo: track.trackNo,
        })
        changed = true
      }
      if (changed) fixed += 1
      const parts: string[] = []
      if (Object.keys(patch).length) parts.push('标签')
      if (want.lyric && !info.lyricPath) parts.push('歌词')
      if (want.cover && !info.coverPath && !info.hasEmbeddedCover) parts.push('封面')
      if (want.nfo && !info.nfoPath) parts.push('NFO')
      logEvent(
        'info',
        '补缺',
        `${track.title}${track.artists[0] ? ' - ' + track.artists[0] : ''}`,
        changesParts(parts, changed, match.providerId),
      )
    } catch (err) {
      const title = path.basename(input)
      errors.push({ path: input, error: err instanceof Error ? err.message : String(err) })
      logEvent('warn', '补缺', title, `失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return { fixed, errors }
}

const require = createRequire(import.meta.url)
function converter(direction: 's2t' | 't2s') {
  const OpenCC = require('opencc-js')
  return direction === 's2t' ? OpenCC.Converter({ from: 'cn', to: 'tw' }) : OpenCC.Converter({ from: 'tw', to: 'cn' })
}

export async function convertNames(inputs: string[], direction: 's2t' | 't2s') {
  const convert = converter(direction)
  const renamed: string[] = []
  const errors: { path: string; error: string }[] = []
  const doRename = async (file: string) => {
    const dir = path.dirname(file)
    const ext = path.extname(file)
    const stem = path.basename(file, ext)
    const next = convert(stem)
    if (next === stem) return
    const target = uniquePath(path.join(dir, `${next}${ext}`))
    await fs.promises.rename(file, target)
    await renameIndexPath(file, target)
    renamed.push(target)
    // 同步同名的 .lrc
    if (AUDIO_EXT.has(ext.toLowerCase())) {
      const lyric = path.join(dir, `${stem}.lrc`)
      if (fs.existsSync(lyric)) {
        const lyricTarget = path.join(path.dirname(target), `${next}.lrc`)
        if (!fs.existsSync(lyricTarget)) await fs.promises.rename(lyric, lyricTarget)
      }
    }
  }
  for (const input of inputs) {
    try {
      const { abs } = rootFor(input)
      const stat = await fs.promises.stat(abs)
      if (stat.isFile()) {
        await doRename(abs)
        continue
      }
      const entries: string[] = []
      const collect = async (dir: string) => {
        const list = await fs.promises.readdir(dir, { withFileTypes: true })
        for (const entry of list) {
          if (entry.name.startsWith('.')) continue
          const full = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            await collect(full)
            entries.push(full)
          } else entries.push(full)
        }
      }
      await collect(abs)
      entries.sort((a, b) => b.split(path.sep).length - a.split(path.sep).length)
      for (const entry of entries) {
        try {
          const statEntry = await fs.promises.stat(entry)
          if (statEntry.isDirectory()) {
            const dir = path.dirname(entry)
            const next = convert(path.basename(entry))
            if (next !== path.basename(entry)) {
              const target = uniquePath(path.join(dir, next))
              await fs.promises.rename(entry, target)
              await renameIndexPath(entry, target)
              renamed.push(target)
            }
          } else await doRename(entry)
        } catch (err) {
          errors.push({ path: entry, error: err instanceof Error ? err.message : String(err) })
        }
      }
    } catch (err) {
      errors.push({ path: input, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return { renamed: renamed.length, paths: renamed, errors }
}

function decodeLyric(buf: Buffer, sourceEncoding?: string) {
  if (sourceEncoding && sourceEncoding !== 'auto') return iconv.decode(buf, sourceEncoding)
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return iconv.decode(buf, 'utf16le')
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return iconv.decode(buf, 'utf16be')
  if (isUtf8(buf)) return buf.toString('utf8')
  return iconv.decode(buf, 'gb18030')
}

async function collectLyrics(input: string, out: string[]) {
  const stat = await fs.promises.stat(input)
  if (stat.isFile()) {
    if (path.extname(input).toLowerCase() === '.lrc') out.push(input)
    return
  }
  const entries = await fs.promises.readdir(input, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const full = path.join(input, entry.name)
    if (entry.isDirectory()) await collectLyrics(full, out)
    else if (path.extname(entry.name).toLowerCase() === '.lrc') out.push(full)
  }
}

export async function convertLyrics(inputs: string[], direction?: 's2t' | 't2s', sourceEncoding?: string, bom = false) {
  const convert = direction ? converter(direction) : null
  const files: string[] = []
  for (const input of inputs) {
    try {
      const { abs } = rootFor(input)
      await collectLyrics(abs, files)
    } catch {
      /* ignore invalid path */
    }
  }
  const converted: any[] = []
  const errors: { path: string; error: string }[] = []
  for (const file of [...new Set(files)]) {
    try {
      const buf = await fs.promises.readFile(file)
      let text = decodeLyric(buf, sourceEncoding)
      const encoding = sourceEncoding && sourceEncoding !== 'auto' ? sourceEncoding : isUtf8(buf) ? 'utf-8' : 'gb18030'
      if (convert) text = convert(text)
      await fs.promises.writeFile(file, `${bom ? '\uFEFF' : ''}${text}`, 'utf8')
      converted.push({ path: file, from: encoding })
    } catch (err) {
      errors.push({ path: file, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return { converted: converted.length, items: converted, errors }
}
