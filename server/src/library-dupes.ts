import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { db, now } from './db.js'
import { config } from './config.js'

const EXT_RANK: Record<string, number> = {
  flac: 7,
  dsf: 7,
  wav: 6,
  ape: 6,
  m4a: 5,
  ogg: 4,
  aac: 4,
  mp3: 3,
  wma: 2,
}

export interface DuplicateFile {
  path: string
  root: string
  title: string
  artist: string
  album: string
  durationMs: number
  size: number
  ext: string
  bitrate: number
  codec: string
  md5?: string
  keep?: boolean
}

export interface DuplicateGroup {
  key: string
  title: string
  artist: string
  durationMs: number
  confidence: 'high' | 'medium' | 'low'
  matchType: 'exact' | 'metadata'
  keep: string
  reclaimBytes: number
  files: DuplicateFile[]
}

const clean = (value: string) => (value || '').normalize('NFKC').toLowerCase()

function artistKey(value: string): string {
  // 保留完整歌手名（含合作歌手），避免把独唱和 feat. 版本误判为重复
  return clean(value).replace(/[^\p{L}\p{N}]/gu, '').trim()
}

function titleKey(value: string): string {
  return clean(value).replace(/[\s\-_·・.,，。'’"“”()（）[\]【】]/g, '').trim()
}

// 版本特征：Instrumental/Remix/Live/伴奏/feat./Explicit 等不同版本不能算重复
function versionKey(filePath: string): string {
  const name = path.basename(filePath, path.extname(filePath)).toLowerCase()
  const parent = path.basename(path.dirname(filePath)).toLowerCase()
  const text = `${name} ${parent}`
  const keywords = [
    ...text.matchAll(
      /instrumental|inst\b|off\s*vocal|karaoke|伴奏|纯音乐|acoustic|unplugged|live|remix|extended|radio\s*edit|club\s*mix|a\s*cappella|acappella|acapella|demo|sped\s*up|slowed|nightcore|mochapella|on\s*vacation|feat\.?|ft\.?|explicit|clean/gi,
    ),
  ].map((match) => match[0].replace(/\s+/g, '').toLowerCase())
  const paren = [...name.matchAll(/[\(\[（【]([^\)\]）】]+)[\)\]）】]/g)]
    .map((match) => match[1].toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, ''))
    .join('|')
  return `${paren}|${[...new Set(keywords)].sort().join(',')}`
}

function qualityScore(file: DuplicateFile): number {
  const rank = EXT_RANK[file.ext] || 1
  return rank * 1e15 + (file.bitrate || 0) * 1e6 + file.size
}

function md5File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5')
    const stream = fs.createReadStream(file)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

export async function findDuplicates(): Promise<{
  scanned: number
  totalGroups: number
  totalFiles: number
  reclaimBytes: number
  groups: DuplicateGroup[]
}> {
  const rows = db
    .prepare(
      'SELECT path, root, title, artist, album, duration_ms, size, ext, bitrate, codec FROM library_files ORDER BY path',
    )
    .all() as any[]

  const buckets = new Map<string, DuplicateFile[]>()
  for (const row of rows) {
    const title = String(row.title || '').trim()
    const artist = String(row.artist || '').trim()
    const key = `${artistKey(artist)}#${titleKey(title)}#${versionKey(row.path)}`
    if (!artistKey(artist) || !titleKey(title)) continue
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key)!.push({
      path: row.path,
      root: row.root,
      title,
      artist,
      album: row.album || '',
      durationMs: Number(row.duration_ms || 0),
      size: Number(row.size || 0),
      ext: String(row.ext || '').toLowerCase(),
      bitrate: Number(row.bitrate || 0),
      codec: row.codec || '',
    })
  }

  const groups: DuplicateGroup[] = []
  for (const [key, all] of buckets) {
    if (all.length < 2) continue
    // 同名同歌手再按时长聚类（±5s），避免把 Live/Remix 等不同版本误判
    const sorted = [...all].sort((a, b) => a.durationMs - b.durationMs)
    const clusters: DuplicateFile[][] = []
    let current: DuplicateFile[] = []
    for (const file of sorted) {
      if (!current.length) {
        current = [file]
        continue
      }
      const first = current[0]
      const sameDurationWindow =
        first.durationMs > 0 && file.durationMs > 0 && file.durationMs - first.durationMs <= 5000
      if (sameDurationWindow) current.push(file)
      else {
        clusters.push(current)
        current = [file]
      }
    }
    if (current.length) clusters.push(current)

    for (const cluster of clusters) {
      if (cluster.length < 2) continue
      const sortedByQuality = [...cluster].sort((a, b) => qualityScore(b) - qualityScore(a))
      const keep = sortedByQuality[0]
      const confidence: DuplicateGroup['confidence'] =
        cluster.every((f) => f.durationMs > 0) ? 'high' : 'low'

      // 同尺寸文件做 MD5 校验：确认“完全相同的文件”，其他按元数据判定
      const sizeCounts = new Map<number, number>()
      for (const f of cluster) sizeCounts.set(f.size, (sizeCounts.get(f.size) || 0) + 1)
      const hashCandidates = cluster.filter((f) => (sizeCounts.get(f.size) || 0) > 1 && f.size < 500 * 1024 * 1024)
      for (const f of hashCandidates) {
        try {
          f.md5 = await md5File(f.path)
        } catch {
          /* 文件不可读时忽略 */
        }
      }
      const md5Counts = new Map<string, number>()
      for (const f of cluster) if (f.md5) md5Counts.set(f.md5, (md5Counts.get(f.md5) || 0) + 1)
      const matchType: DuplicateGroup['matchType'] =
        [...md5Counts.values()].some((count) => count > 1) ? 'exact' : 'metadata'

      const reclaimBytes = cluster.reduce((sum, f) => sum + f.size, 0) - keep.size
      groups.push({
        key,
        title: keep.title,
        artist: keep.artist,
        durationMs: keep.durationMs,
        confidence,
        matchType,
        keep: keep.path,
        reclaimBytes,
        files: sortedByQuality.map((f) => ({ ...f, keep: f.path === keep.path })),
      })
    }
  }

  groups.sort((a, b) => b.reclaimBytes - a.reclaimBytes)
  return {
    scanned: rows.length,
    totalGroups: groups.length,
    totalFiles: groups.reduce((sum, group) => sum + group.files.length, 0),
    reclaimBytes: groups.reduce((sum, group) => sum + group.reclaimBytes, 0),
    groups,
  }
}

export type DeleteMode = 'trash' | 'permanent'

export async function deleteLibraryFiles(paths: string[], mode: DeleteMode) {
  const deleted: string[] = []
  const errors: { path: string; error: string }[] = []
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const trashDir = path.join(config.dataDir, 'trash', stamp)

  for (const raw of paths) {
    const file = path.resolve(raw)
    const row = db.prepare('SELECT path, root FROM library_files WHERE path = ?').get(file) as any
    if (!row) {
      errors.push({ path: raw, error: '不在媒体库索引中' })
      continue
    }
    const root = path.resolve(row.root || '')
    const rel = path.relative(root, file)
    if (!root || rel.startsWith('..') || path.isAbsolute(rel)) {
      errors.push({ path: raw, error: '路径不在媒体库根目录内' })
      continue
    }
    try {
      if (mode === 'permanent') {
        await fs.promises.unlink(file)
      } else {
        const safeRoot = root.replace(/^[/\\]+/, '').replace(/[/\\]+/g, '_')
        const dest = path.join(trashDir, safeRoot, rel)
        await fs.promises.mkdir(path.dirname(dest), { recursive: true })
        try {
          await fs.promises.rename(file, dest)
        } catch (err: any) {
          if (err?.code !== 'EXDEV') throw err
          await fs.promises.copyFile(file, dest)
          await fs.promises.unlink(file)
        }
      }
      db.prepare('DELETE FROM library_files WHERE path = ?').run(file)
      deleted.push(file)
      // 顺手清理空目录
      let dir = path.dirname(file)
      while (dir !== root && dir.startsWith(root)) {
        try {
          const entries = await fs.promises.readdir(dir)
          if (entries.length) break
          await fs.promises.rmdir(dir)
        } catch {
          break
        }
        dir = path.dirname(dir)
      }
    } catch (err) {
      errors.push({ path: raw, error: err instanceof Error ? err.message : String(err) })
    }
  }

  return { deleted: deleted.length, paths: deleted, errors, trashDir: mode === 'trash' ? trashDir : undefined }
}

export async function autoDedupe(mode: DeleteMode, dryRun = false) {
  const scan = await findDuplicates()
  // 自动清理只处理高置信度（同名同歌手、时长±5s、版本标识一致）的组
  const targets = scan.groups
    .filter((group) => group.confidence === 'high')
    .flatMap((group) => group.files.filter((file) => !file.keep).map((file) => file.path))
  const reclaimBytes = scan.groups
    .filter((group) => group.confidence === 'high')
    .reduce((sum, group) => sum + group.reclaimBytes, 0)

  if (dryRun) return { dryRun: true, targets: targets.length, reclaimBytes, paths: targets }
  const result = await deleteLibraryFiles(targets, mode)
  return { ...result, targets: targets.length, reclaimBytes }
}
