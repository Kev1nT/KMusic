import fs from 'node:fs'
import path from 'node:path'
import { rootFor, readTags, renameIndexPath } from './files.js'
import { db } from './db.js'
import { renderTemplate, resolveInside } from './download/naming.js'

const AUDIO_EXT = new Set(['.flac', '.mp3', '.m4a', '.ape', '.wav', '.ogg', '.aac', '.wma', '.dsf'])

// 旧媒体库常用分号分隔多个歌手，整理时统一为「 & 」而不是把 & 写成 ;
function displayArtist(value: string): string {
  return (value || '').replace(/\s*[;；]\s*/g, '&').trim()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// 部分老文件的 TITLE 里带了「歌手-歌曲名」前缀，整理时去掉，避免歌曲名前面重复出现歌手
function cleanTitle(title: string, rawArtists: string): string {
  const display = displayArtist(rawArtists)
  const variants = [display, rawArtists, ...rawArtists.split(/[;；]/).map((item) => item.trim())].filter(Boolean)
  for (const variant of variants) {
    const re = new RegExp(`^\\s*${escapeRegExp(variant)}\\s*(?:[-–—_|:：]+\\s*)+`, 'i')
    if (re.test(title)) {
      const stripped = title.replace(re, '').trim()
      if (stripped) return stripped
    }
  }
  return title
}

export interface OrganizeItem {
  from: string
  to: string
  status: 'move' | 'skip' | 'conflict' | 'error'
  reason?: string
}

async function collectAudio(input: string, out: string[]) {
  const stat = await fs.promises.stat(input)
  if (stat.isFile()) {
    if (AUDIO_EXT.has(path.extname(input).toLowerCase())) out.push(input)
    return
  }
  const entries = await fs.promises.readdir(input, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const full = path.join(input, entry.name)
    if (entry.isDirectory()) await collectAudio(full, out)
    else if (AUDIO_EXT.has(path.extname(entry.name).toLowerCase())) out.push(full)
  }
}

async function moveFile(from: string, to: string) {
  await fs.promises.mkdir(path.dirname(to), { recursive: true })
  try {
    await fs.promises.rename(from, to)
  } catch (err: any) {
    if (err?.code !== 'EXDEV') throw err
    await fs.promises.copyFile(from, to)
    await fs.promises.unlink(from)
  }
}

async function pruneEmpty(dir: string, root: string) {
  let current = dir
  while (current !== root && current.startsWith(root + path.sep)) {
    try {
      const entries = await fs.promises.readdir(current)
      if (entries.length) break
      await fs.promises.rmdir(current)
    } catch {
      break
    }
    current = path.dirname(current)
  }
}

export async function organizeFiles(inputs: string[], targetRoot: string, template: string, dryRun: boolean) {
  const { abs } = rootFor(targetRoot)
  const root = abs
  if (!template.trim()) throw new Error('命名规则不能为空')
  const files: string[] = []
  for (const input of inputs) {
    const { abs } = rootFor(input)
    await collectAudio(abs, files)
  }
  const items: OrganizeItem[] = []
  let moved = 0
  let skipped = 0
  let conflicts = 0
  let errors = 0

  for (const from of [...new Set(files)]) {
    try {
      const info = await readTags(from)
      const ext = path.extname(from).slice(1).toLowerCase()
      const displayArtists = displayArtist(info.tags.artist || '未知歌手')
      const relative = renderTemplate(template, {
        artist: displayArtists,
        artists: displayArtists,
        album: info.tags.album || '未知专辑',
        title: cleanTitle(info.tags.title || path.basename(from, path.extname(from)), info.tags.artist || ''),
        track: Number(String(info.tags.track).split('/')[0]) || undefined,
        year: info.tags.year,
        ext,
      })
      const to = resolveInside(root, template.includes('{ext}') ? relative : `${relative}.${ext}`)
      if (path.resolve(from) === path.resolve(to)) {
        skipped += 1
        items.push({ from, to, status: 'skip', reason: '已在目标位置' })
        continue
      }
      if (fs.existsSync(to)) {
        conflicts += 1
        items.push({ from, to, status: 'conflict', reason: '目标已存在，未覆盖' })
        continue
      }
      if (dryRun) {
        moved += 1
        items.push({ from, to, status: 'move' })
        continue
      }
      await moveFile(from, to)
      await renameIndexPath(from, to)
      db.prepare('UPDATE library_files SET root = ? WHERE path = ?').run(root, to)
      // 同步歌词和专辑附属文件
      const fromBase = path.basename(from, path.extname(from))
      const toBase = path.basename(to, path.extname(to))
      const sourceDir = path.dirname(from)
      const targetDir = path.dirname(to)
      for (const suffix of ['.lrc', '.txt']) {
        const lyricFrom = path.join(sourceDir, `${fromBase}${suffix}`)
        if (fs.existsSync(lyricFrom)) {
          const lyricTo = path.join(targetDir, `${toBase}${suffix}`)
          if (!fs.existsSync(lyricTo)) await moveFile(lyricFrom, lyricTo)
        }
      }
      for (const name of ['cover.jpg', 'album.jpg', 'folder.jpg', 'album.nfo']) {
        const assetFrom = path.join(sourceDir, name)
        const assetTo = path.join(targetDir, name)
        if (fs.existsSync(assetFrom) && !fs.existsSync(assetTo)) {
          await fs.promises.copyFile(assetFrom, assetTo)
        }
      }
      await pruneEmpty(sourceDir, root)
      moved += 1
      items.push({ from, to, status: 'move' })
    } catch (err) {
      errors += 1
      items.push({ from, to: '', status: 'error', reason: err instanceof Error ? err.message : String(err) })
    }
  }

  return {
    dryRun,
    root,
    total: items.length,
    moved,
    skipped,
    conflicts,
    errors,
    items: items.slice(0, 1000),
  }
}
