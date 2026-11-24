import fs from 'node:fs'
import path from 'node:path'
import { once } from 'node:events'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Readable } from 'node:stream'
import { config } from '../config.js'
import { getAccount, getDefaultAccount, getTask, listTasks, updateTask } from '../db.js'
import { decrypt } from '../crypto.js'
import { getSettings } from '../settings.js'
import { logEvent } from '../logger.js'
import { getProvider } from '../providers/registry.js'
import { probe, tagAndFinalize, writeAlbumNfo, writeLrc } from './tagger.js'
import { fetchBestCover } from './cover.js'
import { scrapeMeta } from './scrape.js'
import { renderTemplate, resolveInside } from './naming.js'
import { HttpError, UA, sleep } from '../util/http.js'
import { runAppleEngine } from '../providers/apple/engine.js'
import type { Quality, Track, TaskRow } from '../types.js'

const queue: number[] = []
const queued = new Set<number>()
let running = 0
let pumping = false

const execFileAsync = promisify(execFile)

const tmpRoot = path.join(config.dataDir, 'tmp')

export function enqueueTask(id: number) {
  if (queued.has(id)) return
  queued.add(id)
  queue.push(id)
  void pump()
}

export function resumePending() {
  for (const row of listTasks(500)) {
    if (['queued', 'resolving', 'downloading', 'verifying', 'tagging'].includes(row.status)) {
      updateTask(row.id, { status: 'queued', progress: 0, error: null })
      enqueueTask(row.id)
    }
  }
}

async function pump() {
  if (pumping) return
  pumping = true
  try {
    const settings = getSettings()
    while (running < Math.max(1, settings.concurrency) && queue.length) {
      const id = queue.shift()!
      queued.delete(id)
      const task = getTask(id)
      if (!task || ['done', 'canceled', 'failed'].includes(task.status)) continue
      running += 1
      void processTask(task)
        .catch((err) => {
          console.error(`[task ${id}]`, err)
          const failedTask = getTask(id)
          logEvent(
            'error',
            '下载',
            failedTask ? `${failedTask.title}${failedTask.artists ? ' - ' + failedTask.artists : ''}` : `任务 #${id}`,
            `失败：${err instanceof Error ? err.message : String(err)}`,
          )
          updateTask(id, {
            status: 'failed',
            error: err instanceof Error ? err.message : String(err),
            progress: 100,
          })
        })
        .finally(() => {
          running -= 1
          void pump()
        })
    }
  } finally {
    pumping = false
  }
}

function accountFor(task: TaskRow) {
  const settings = getSettings()
  const preferred = settings.downloadAccountId ? getAccount(settings.downloadAccountId) : undefined
  const explicit = task.account_id ? getAccount(task.account_id) : undefined
  const account =
    (preferred && preferred.provider === task.provider ? preferred : undefined) ||
    (explicit && explicit.provider === task.provider ? explicit : undefined) ||
    getDefaultAccount(task.provider)
  if (!account) return undefined
  try {
    return {
      cookie: decrypt(account.cookie_enc),
      uin: account.uid,
      vip: account.vip,
      libraryPath: account.library_path || '',
    }
  } catch {
    return { cookie: '', uin: account.uid, vip: account.vip, libraryPath: account.library_path || '' }
  }
}

function ladder(preferred: Quality): Quality[] {
  const all: Quality[] = ['hires', 'flac', '320', '128']
  const idx = all.indexOf(preferred)
  return idx < 0 ? all : all.slice(idx)
}

async function downloadFile(
  url: string,
  dest: string,
  referer: string | undefined,
  onProgress: (received: number, total: number) => void,
) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, ...(referer ? { Referer: referer } : {}) },
    redirect: 'follow',
  })
  if (!res.ok || !res.body) throw new Error(`下载失败 HTTP ${res.status}`)
  const total = Number(res.headers.get('content-length') || 0)
  await fs.promises.mkdir(path.dirname(dest), { recursive: true })
  const out = fs.createWriteStream(dest)
  let received = 0
  let lastTick = 0
  try {
    for await (const chunk of Readable.fromWeb(res.body as any)) {
      received += chunk.length
      if (!out.write(chunk)) await once(out, 'drain')
      const now = Date.now()
      if (now - lastTick > 300) {
        lastTick = now
        onProgress(received, total)
      }
    }
  } finally {
    await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())))
  }
  onProgress(received, total)
  return { received, total }
}

function uniquePath(target: string): string {
  if (!fs.existsSync(target)) return target
  const dir = path.dirname(target)
  const ext = path.extname(target)
  const base = path.basename(target, ext)
  for (let i = 2; i < 100; i++) {
    const candidate = path.join(dir, `${base} (${i})${ext}`)
    if (!fs.existsSync(candidate)) return candidate
  }
  throw new Error('同名文件过多')
}

/** ALAC(m4a) → 真正的 FLAC 文件（无损转无损），保留标签与内嵌封面。 */
async function convertToFlac(src: string): Promise<string> {
  const dst = src.replace(/\.m4a$/i, '.flac')
  const base = ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-map', '0:a']
  try {
    await execFileAsync('ffmpeg', [...base, '-map', '0:v', '-c:v', 'copy', '-disposition:v', 'attached_pic', '-map_metadata', '0', '-c:a', 'flac', dst])
  } catch {
    await execFileAsync('ffmpeg', [...base, '-map_metadata', '0', '-c:a', 'flac', dst])
  }
  await fs.promises.rm(src, { force: true })
  return dst
}

/** Apple Music：kmusic 内置 apple-music-dl 引擎直接下载（HLS + FairPlay 解密 + 打标签 + 歌词）。 */
async function listFilesDeep(root: string): Promise<Set<string>> {
  const out = new Set<string>()
  async function walk(d: string) {
    let ents: fs.Dirent[]
    try {
      ents = await fs.promises.readdir(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of ents) {
      const full = path.join(d, e.name)
      if (e.isDirectory()) await walk(full)
      else out.add(full)
    }
  }
  await walk(root)
  return out
}

async function pruneEmptyDirs(dir: string, stop: string): Promise<void> {
  let ents: fs.Dirent[]
  try {
    ents = await fs.promises.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  let empty = true
  for (const e of ents) {
    if (e.isDirectory()) {
      await pruneEmptyDirs(path.join(dir, e.name), stop)
      // 子目录可能已删，重新判断
      try {
        if ((await fs.promises.readdir(path.join(dir, e.name))).length) empty = false
      } catch {
        /* 已删除 */
      }
    } else {
      empty = false
    }
  }
  if (empty && dir !== stop) {
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

async function processAppleTask(task: TaskRow): Promise<void> {
  const settings = getSettings()
  const url = task.source_url || ''
  if (!url) throw new Error('该任务缺少 Apple Music 链接（source_url 为空）')
  const cancelled = () => getTask(task.id)?.status === 'canceled'

  // 双下模式：同时下载 ALAC 无损 + Dolby Atmos，各自落各自目录；
  // 某首没有 Atmos 时引擎那次自然 0 产出，不影响无损结果。
  const codecs: string[] = settings.appleDualDownload
    ? ['alac', 'atmos']
    : [settings.appleCodec || 'alac']

  const root = path.join(tmpRoot, `task-${task.id}`)
  await fs.promises.rm(root, { recursive: true, force: true })
  await fs.promises.mkdir(root, { recursive: true })

  updateTask(task.id, { status: 'resolving', progress: 5, error: null })
  updateTask(task.id, { status: 'downloading', progress: 10 })

  const seg = (88 - 10) / codecs.length
  const all: string[] = []
  const notes: string[] = []
  let okCount = 0

  for (let i = 0; i < codecs.length; i++) {
    if (cancelled()) break
    const codec = codecs[i]
    const workDir = path.join(root, codec)
    const atmosRoot = settings.appleAtmosDir
    const beforeAtmos = codec === 'atmos' ? await listFilesDeep(atmosRoot) : null
    const result = await runAppleEngine({
      url,
      codec,
      wrapperUrl: settings.appleWrapperUrl,
      settings,
      workDir,
      isCancelled: cancelled,
      onProgress: (pct) => {
        const shown = Math.round(10 + i * seg + (Math.max(0, Math.min(100, pct)) / 100) * seg)
        updateTask(task.id, { progress: Math.max(10, Math.min(88, shown)) })
      },
    })
    let got = result.tracks.map((t) => t.path).filter(Boolean)
    if (settings.appleConvertFlac && codec === 'alac' && got.length) {
      const converted: string[] = []
      for (const f of got) {
        if (/\.m4a$/i.test(f)) {
          try {
            converted.push(await convertToFlac(f))
          } catch {
            converted.push(f)
          }
        } else {
          converted.push(f)
        }
      }
      got = converted
    }
    all.push(...got)
    if (got.length > 0) {
      okCount++
    } else if (codecs.length > 1) {
      // 双下时某个音质没产出：把引擎 stderr 尾部也带上，便于看清真实原因
      const tail = String(result.error || '').split('\n').map((l) => l.trim()).filter(Boolean).slice(-3).join(' ')
      notes.push((codec === 'atmos' ? '无可用全景声资源' : `${codec} 无产出`) + (tail ? `：${tail.slice(0, 200)}` : ''))
      // 该曲无 Atmos 音频时，引擎仍可能写出 .lrc/cover.jpg，清理这些残留，避免脏目录
      if (codec === 'atmos' && beforeAtmos) {
        try {
          const after = await listFilesDeep(atmosRoot)
          for (const f of after) if (!beforeAtmos.has(f)) await fs.promises.rm(f, { force: true }).catch(() => {})
          await pruneEmptyDirs(atmosRoot, atmosRoot)
        } catch {
          /* 忽略 */
        }
      }
    } else if (result.error) {
      const tail = String(result.error).split('\n').filter(Boolean).slice(-6).join(' ')
      throw new Error(`Apple 下载未产出文件。引擎输出：${tail || '(空)'}`)
    }
  }

  if (cancelled()) {
    await fs.promises.rm(root, { recursive: true, force: true }).catch(() => {})
    return
  }
  if (all.length === 0) {
    throw new Error(`Apple 下载未产出文件${notes.length ? `（${notes.join(' · ')}）` : ''}`)
  }

  let bytes = 0
  for (const f of all) {
    try {
      bytes += fs.statSync(f).size
    } catch {
      /* 文件可能被移动 */
    }
  }
  const filePath = all.length === 1 ? all[0] : path.dirname(all[0])
  logEvent(
    'info',
    '下载',
    `${task.title}${task.artists ? ' - ' + task.artists : ''}`,
    `完成：${filePath}${notes.length ? ' · ' + notes.join(' · ') : ''}`,
  )
  updateTask(task.id, {
    status: 'done',
    progress: 100,
    file_path: filePath,
    received_bytes: bytes,
    total_bytes: bytes,
    error: okCount < codecs.length ? notes.join(' · ').slice(0, 500) : null,
  })
  await fs.promises.rm(root, { recursive: true, force: true }).catch(() => {})
}

async function processTask(task: TaskRow) {
  const settings = getSettings()
  const provider = getProvider(task.provider)
  const account = accountFor(task)
  if (task.provider === 'apple') return processAppleTask(task)

  const workDir = path.join(tmpRoot, `task-${task.id}`)
  await fs.promises.rm(workDir, { recursive: true, force: true })
  await fs.promises.mkdir(workDir, { recursive: true })

  const cancelled = () => getTask(task.id)?.status === 'canceled'

  updateTask(task.id, { status: 'resolving', progress: 5, error: null })
  const track: Track = {
    provider: task.provider,
    id: task.track_id,
    title: task.title,
    artists: task.artists.split(/\s*\/\s*/).filter(Boolean),
    album: task.album,
    albumId: task.album_id,
    durationMs: task.duration_ms,
    cover: task.cover,
    mediaMid: task.media_mid || undefined,
    qualities: ['flac', '320', '128'],
  }

  const preferred = (task.quality as Quality) || settings.quality
  const qualities = settings.fallback ? ladder(preferred) : [preferred]

  let resolved: { url: string; ext: string; quality: Quality } | null = null
  let rawFile = ''
  let lastError: Error | null = null
  let sawUrl = false
  let sawAudio = false
  const REFERERS: Record<string, string> = {
    qq: 'https://y.qq.com/',
    netease: 'https://music.163.com/',
    qishui: 'https://www.douyin.com/',
  }

  // 音质从高到低逐个尝试：高音质没权限/不存在时自动降级，试听片段也继续降级
  for (const q of qualities) {
    if (cancelled()) return
    let got: { url: string; ext: string; quality?: Quality } | null = null
    try {
      got = await provider.getUrl(track, q, account)
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      continue
    }
    if (!got) continue
    sawUrl = true
    const actual = got.quality || q
    updateTask(task.id, { status: 'downloading', quality: actual, progress: 10 })
    rawFile = path.join(workDir, `audio.${got.ext}`)
    await fs.promises.rm(rawFile, { force: true })
    let lastProgress = 10
    try {
      await downloadFile(got.url, rawFile, REFERERS[task.provider], (received, total) => {
        const pct = total > 0 ? Math.min(80, 10 + Math.floor((received / total) * 70)) : lastProgress
        if (pct > lastProgress + 2) {
          lastProgress = pct
          updateTask(task.id, { progress: pct, received_bytes: received, total_bytes: total })
        }
      })
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      continue
    }
    if (cancelled()) return
    updateTask(task.id, { status: 'verifying', progress: 82 })
    let info
    try {
      info = await probe(rawFile)
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      continue
    }
    sawAudio = true
    if (info.duration <= 1) {
      lastError = new Error('音频文件无效')
      continue
    }
    if (task.duration_ms > 30_000 && info.duration < (task.duration_ms / 1000) * 0.6) {
      lastError = new Error(
        `疑似试听片段（${Math.round(info.duration)}s / 预期 ${Math.round(task.duration_ms / 1000)}s）`,
      )
      continue
    }
    if (got.ext === 'flac' && info.codec !== 'flac') {
      lastError = new Error(`音质不符：期望 FLAC，实际 ${info.codec}`)
      continue
    }
    resolved = { url: got.url, ext: got.ext, quality: actual }
    break
  }

  // 曲目失效（汽水这类平台会下架换 id）：按歌名+歌手列出候选，逐个试到「能播且能下」为止
  if (!resolved && provider.repair) {
    const altList = await provider.repair(track).catch(() => [] as Track[])
    logEvent(
      altList.length ? 'info' : 'warn',
      '修复',
      `${task.title}`,
      altList.length ? `找到 ${altList.length} 个候选：${altList.map((a) => a.title).join(' / ').slice(0, 80)}` : '未找到同名同艺术家的可替换曲目（不会下别的版本）',
    )
    for (const alt of altList) {
      if (!alt?.id || alt.id === track.id) continue
      if (cancelled()) return
      for (const q of qualities) {
        let gotAlt: { url: string; ext: string; quality?: Quality } | null = null
        try {
          gotAlt = await provider.getUrl(alt, q, account)
        } catch {
          continue
        }
        if (!gotAlt) continue
        const rawAlt = path.join(workDir, `alt.${gotAlt.ext}`)
        await fs.promises.rm(rawAlt, { force: true })
        try {
          await downloadFile(gotAlt.url, rawAlt, REFERERS[task.provider], () => {})
        } catch {
          continue
        }
        try {
          const infoAlt = await probe(rawAlt)
          if (infoAlt.duration <= 1) continue
          if (task.duration_ms > 30_000 && infoAlt.duration < (task.duration_ms / 1000) * 0.6) continue
          if (gotAlt.ext === 'flac' && infoAlt.codec !== 'flac') continue
        } catch {
          continue
        }
        resolved = { url: gotAlt.url, ext: gotAlt.ext, quality: gotAlt.quality || q }
        rawFile = rawAlt
        sawAudio = true
        track.id = alt.id
        track.title = alt.title || track.title
        track.album = alt.album || track.album
        track.albumId = alt.albumId || track.albumId
        track.cover = alt.cover || track.cover
        updateTask(task.id, {
          track_id: alt.id,
          title: track.title,
          album: track.album,
          album_id: track.albumId,
          cover: track.cover,
        })
        logEvent('info', '修复', `${task.title}`, `已匹配新曲目「${alt.title}」并下载成功`)
        break
      }
      if (resolved) break
    }
  }

  if (!resolved) {
    if (!sawUrl && lastError) throw lastError
    if (sawUrl) {
      throw new Error(lastError ? `仅获取到试听/无效音频：${lastError.message}` : '仅获取到试听片段')
    }
    throw new Error(
      `该歌曲在${provider.name}各音质均无可用地址，可能无版权/已下架/需单独购买，或账号没有对应音质权限；已尝试 Hi-Res / FLAC / 320K / 128K`,
    )
  }

  const lyric =
    settings.embedLyrics || settings.writeLrc ? await provider.lyric(track).catch(() => null) : null

  updateTask(task.id, { status: 'tagging', progress: 88 })

  // 缺封面/专辑时跨平台兜底刮削（汽水封面是签名 URI，直接拿不到）
  let metaCover = track.cover
  let metaAlbum = track.album
  let metaYear = task.year
  if (!metaCover || !metaAlbum) {
    const scraped = await scrapeMeta(track.title, track.artists).catch(() => ({}) as any)
    if (!metaCover && scraped.cover) metaCover = scraped.cover
    if (!metaAlbum && scraped.album) metaAlbum = scraped.album
    if (!metaYear && scraped.year) metaYear = scraped.year
  }

  const relative = renderTemplate(settings.template, {
    artist: track.artists[0] || '未知歌手',
    artists: track.artists.join(' / '),
    album: metaAlbum,
    title: track.title,
    track: task.track_no,
    year: metaYear,
    source: track.provider,
    ext: resolved.ext,
  })
  const libraryRoot = path.resolve(account?.libraryPath || settings.libraryPath)
  const target = uniquePath(resolveInside(libraryRoot, `${relative}.${resolved.ext}`))
  await fs.promises.mkdir(path.dirname(target), { recursive: true })

  const coverPath =
    settings.embedCover || settings.writeNfo
      ? await fetchBestCover(metaCover || '', path.join(workDir, 'cover.jpg'), settings.coverSize)
      : null
  const tagged = path.join(workDir, `tagged.${resolved.ext}`)
  await tagAndFinalize({
    input: rawFile,
    output: tagged,
    title: track.title,
    artists: track.artists,
    album: metaAlbum,
    albumArtist: track.artists[0],
    track: task.track_no,
    year: metaYear,
    lyric: settings.embedLyrics ? lyric : null,
    cover: settings.embedCover ? coverPath : null,
    ext: resolved.ext,
  })

  await fs.promises.copyFile(tagged, `${target}.part`)
  await fs.promises.rename(`${target}.part`, target)

  if (settings.writeLrc && lyric) {
    await writeLrc(target.slice(0, -`.${resolved.ext}`.length), lyric)
  }
  if (coverPath && settings.writeNfo) {
    const albumDir = path.dirname(target)
    const coverOut = path.join(albumDir, 'cover.jpg')
    if (!fs.existsSync(coverOut)) await fs.promises.copyFile(coverPath, coverOut)
    writeAlbumNfo(albumDir, {
      album: track.album || '未知专辑',
      artists: track.artists,
      year: task.year,
      trackNo: task.track_no,
    })
  }

  const size = fs.statSync(target).size
  logEvent('info', '下载', `${track.title} - ${track.artists.join(' / ')}`, `完成：${target}`)
  updateTask(task.id, {
    status: 'done',
    progress: 100,
    file_path: target,
    received_bytes: size,
    total_bytes: size,
    error: null,
  })
  await fs.promises.rm(workDir, { recursive: true, force: true })
}
