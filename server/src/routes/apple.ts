import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { FastifyInstance } from 'fastify'
import { config } from '../config.js'
import { getCharts } from '../providers/apple/api.js'
import { runAppleEngine } from '../providers/apple/engine.js'
import { getSettings } from '../settings.js'
import { withCoverSize } from '../util/covers.js'

const execFileAsync = promisify(execFile)
const playDir = path.join(config.dataDir, 'playcache')

interface PrepState {
  status: 'preparing' | 'ready' | 'error'
  pct: number
  error?: string
}
const preparing = new Map<string, PrepState>()

function cachePaths(trackId: string) {
  return {
    m4a: path.join(playDir, `${trackId}.m4a`),
    flac: path.join(playDir, `${trackId}.flac`),
  }
}

async function ensureCache(trackId: string, sourceUrl: string): Promise<void> {
  const { m4a } = cachePaths(trackId)
  if (fs.existsSync(m4a) || fs.existsSync(cachePaths(trackId).flac)) return
  await fs.promises.mkdir(playDir, { recursive: true })
  const settings = getSettings()
  const work = path.join(playDir, `work-${trackId}`)
  const res = await runAppleEngine({
    url: sourceUrl,
    codec: 'alac',
    wrapperUrl: settings.appleWrapperUrl,
    settings: { ...settings, appleAlacDir: work, appleConvertFlac: false } as typeof settings,
    workDir: work,
    onProgress: (pct) => {
      const s = preparing.get(trackId)
      if (s) s.pct = pct
    },
  })
  const f = res.tracks.map((t) => t.path).find(Boolean)
  if (!f) throw new Error(res.error || '引擎未产出音频')
  await fs.promises.rename(f, m4a).catch(async () => {
    await fs.promises.copyFile(f, m4a)
    await fs.promises.rm(f, { force: true }).catch(() => {})
  })
  await fs.promises.rm(work, { recursive: true, force: true }).catch(() => {})
}

export function registerAppleRoutes(app: FastifyInstance) {
  // 首页：热门专辑 / 热门歌单 / 空间音频歌单 / 热门歌曲
  app.get('/api/apple/charts', async () => {
    const settings = getSettings()
    const charts = await getCharts()
    return {
      albums: withCoverSize(charts.albums, settings.coverSize),
      playlists: withCoverSize(charts.playlists, settings.coverSize),
      spatialPlaylists: withCoverSize(charts.spatialPlaylists, settings.coverSize),
      songs: withCoverSize(charts.songs, settings.coverSize),
    }
  })

  // 逐字歌词（TTML），来自 wrapper
  app.get('/api/apple/lyrics', async (req) => {
    const trackId = String((req.query as any).trackId || '')
    if (!trackId) return { ttml: '' }
    const wrapper = String(getSettings().appleWrapperUrl || '').replace(/\/+$/, '')
    try {
      const r = await fetch(`${wrapper}/lyrics?adamId=${encodeURIComponent(trackId)}&syllable=1`, {
        signal: AbortSignal.timeout(15_000),
      })
      const j = (await r.json()) as any
      if (j?.code === 0 && j?.data?.lyrics) return { ttml: String(j.data.lyrics) }
    } catch {
      /* 忽略 */
    }
    return { ttml: '' }
  })

  // 准备播放缓存（未缓存时用引擎下载一份 ALAC）
  app.post('/api/apple/prepare', async (req, reply) => {
    const body = req.body as { trackId?: string; sourceUrl?: string }
    const trackId = String(body?.trackId || '')
    const sourceUrl = String(body?.sourceUrl || '')
    if (!trackId || !sourceUrl) return reply.code(400).send({ error: '缺少 trackId 或 sourceUrl' })
    const { m4a, flac } = cachePaths(trackId)
    if (fs.existsSync(m4a) || fs.existsSync(flac)) return { status: 'ready', pct: 100 }
    const cur = preparing.get(trackId)
    if (cur && cur.status === 'preparing') return { status: 'preparing', pct: cur.pct }
    preparing.set(trackId, { status: 'preparing', pct: 0 })
    void ensureCache(trackId, sourceUrl)
      .then(() => preparing.set(trackId, { status: 'ready', pct: 100 }))
      .catch((e) => preparing.set(trackId, { status: 'error', pct: 0, error: String(e?.message || e) }))
    return { status: 'preparing', pct: 0 }
  })

  app.get('/api/apple/prepare/status', async (req) => {
    const trackId = String((req.query as any).trackId || '')
    const { m4a, flac } = cachePaths(trackId)
    if (fs.existsSync(m4a) || fs.existsSync(flac)) return { status: 'ready', pct: 100 }
    return preparing.get(trackId) || { status: 'idle', pct: 0 }
  })

  // 播放流：优先返回 FLAC（浏览器通用），首次访问时把缓存的 m4a 转 FLAC，支持 Range
  app.get('/api/apple/stream', async (req, reply) => {
    const trackId = String((req.query as any).trackId || '')
    const { m4a, flac } = cachePaths(trackId)
    if (!fs.existsSync(flac)) {
      if (!fs.existsSync(m4a)) return reply.code(404).send({ error: '音频尚未准备好' })
      try {
        await execFileAsync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', m4a, '-map', '0:a', '-c:a', 'flac', flac])
      } catch (e) {
        return reply.code(500).send({ error: `转码失败：${e instanceof Error ? e.message : e}` })
      }
    }
    const stat = fs.statSync(flac)
    reply.header('Accept-Ranges', 'bytes').header('Content-Type', 'audio/flac').header('Cache-Control', 'no-store')
    const range = req.headers.range
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(String(range))
      const start = m && m[1] ? Number(m[1]) : 0
      const end = m && m[2] ? Number(m[2]) : stat.size - 1
      if (start >= stat.size) {
        reply.code(416).header('Content-Range', `bytes */${stat.size}`)
        return reply.send()
      }
      reply.code(206).header('Content-Range', `bytes ${start}-${end}/${stat.size}`).header('Content-Length', String(end - start + 1))
      return reply.send(fs.createReadStream(flac, { start, end }))
    }
    reply.header('Content-Length', String(stat.size))
    return reply.send(fs.createReadStream(flac))
  })
}
