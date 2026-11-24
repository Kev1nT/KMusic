import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { Settings } from '../../settings.js'

/**
 * Apple Music 下载引擎封装。
 *
 * 引擎是 zhaarey/apple-music-downloader 的静态二进制（放在镜像 /usr/local/bin/apple-music-dl），
 * 从 kmusic 直接 spawn —— 不经过任何外部 Web 服务。它自己做 HLS 拉流、FairPlay 解密
 * （通过 wrapper 的 /m3u8 /key）、ALAC/Atmos/AAC 封装、元数据与歌词写入。
 *
 * 每首/每张专辑一个子进程，cwd 里放一份任务私有 config.yaml。
 */

export const ENGINE_BIN = process.env.APPLE_ENGINE_BIN || '/usr/local/bin/apple-music-dl'

export interface EngineTrack {
  path: string
  artist?: string
  album?: string
  song?: string
}

export interface EngineSummary {
  completed: number
  total: number
  warnings: number
  errors: number
}

export interface EngineResult {
  ok: boolean
  tracks: EngineTrack[]
  error?: string
  summary?: EngineSummary
}

function q(v: string): string {
  // YAML 双引号字符串对 JSON 转义是兼容的
  return JSON.stringify(String(v ?? ''))
}

export function buildAppleConfig(s: Settings): string {
  const alacDir = String(s.appleAlacDir || '/music/Apple/Lossless').replace(/\/+$/, '')
  const atmosDir = String(s.appleAtmosDir || '/music/Apple/Atmos').replace(/\/+$/, '')
  const aacDir = String(s.appleAacDir || '/music/Apple/AAC').replace(/\/+$/, '')
  const lyricType = s.appleLyricType === 'line' ? 'lyrics' : 'syllable-lyrics'
  return `general:
  lite-server: ${q(s.appleWrapperUrl)}
  language: ""
  storefront: ${q(s.appleStorefront || 'cn')}
  max-memory-limit: 256
  proxy: ""
  exit-on-error: true

media:
  get-m3u8-mode: "hires"
  alac-max: 192000
  atmos-max: 2768
  aac-type: "aac-lc"
  alac-fix: true
  mv:
    audio-type: "atmos"
    max: 2160

paths:
  alac: ${q(alacDir)}
  atmos: ${q(atmosDir)}
  aac: ${q(aacDir)}
  mv: ${q(path.posix.join(aacDir, '..', 'MV'))}
  album-folder: "{AlbumName}"
  playlist-folder: "{PlaylistName}"
  artist-folder: "{UrlArtistName}"
  song-file: "{SongNumer}. {SongName}"
  limit-max: 200
  explicit: "[E]"
  clean: "[C]"
  apple-master: "[M]"

metadata:
  lyrics:
    save-file: ${s.appleSaveLrc ? 'true' : 'false'}
    embed: ${s.appleEmbedLyric ? 'true' : 'false'}
    type: "${lyricType}"
    format: ${q(s.appleLyricFormat || 'lrc')}
    extra: "translation"
  artwork:
    embed: true
    size: ${q(s.appleCoverSize || '3000x3000')}
    format: "jpg"
    save-artist: false
    save-animated: false
    emby-animated: false
    dl-for-playlist: false
  tags:
    sort-order: true
    itunes-id: true
    use-songinfo-for-playlist: false

convert:
  after-download: false
  format: "flac"
  keep-original: false
  skip-if-source-matches: true
  ffmpeg-path: "ffmpeg"
  extra-args: ""
`
}

export function engineArgs(url: string, codec: string, configPath: string, wrapperUrl: string): string[] {
  const args = [url, '--json', '-c', configPath, '--lite-server', wrapperUrl]
  if (codec === 'atmos') args.push('--atmos')
  else if (codec === 'aac') args.push('--aac')
  return args
}

function parseTracks(lines: string[]): EngineTrack[] {
  for (let i = lines.length - 1; i >= 0 && i > lines.length - 80; i--) {
    const line = (lines[i] ?? '').trim()
    if (!line.startsWith('[')) continue
    try {
      const parsed = JSON.parse(line) as unknown
      if (!Array.isArray(parsed)) continue
      return parsed
        .filter((t): t is Record<string, unknown> => typeof t === 'object' && t !== null)
        .map((t) => ({
          path: typeof t['path'] === 'string' ? String(t['path']) : '',
          artist: typeof t['artist'] === 'string' ? String(t['artist']) : '',
          album: typeof t['album'] === 'string' ? String(t['album']) : '',
          song: typeof t['song'] === 'string' ? String(t['song']) : '',
        }))
        .filter((t) => t.path !== '' || t.song !== '')
    } catch {
      /* 不是汇总行 */
    }
  }
  return []
}

function parseSummary(lines: string[]): EngineSummary | undefined {
  const re = /Completed:\s*(\d+)\s*\/\s*(\d+).*?Warnings:\s*(\d+).*?Errors:\s*(\d+)/
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = re.exec(lines[i] ?? '')
    if (!m) continue
    return {
      completed: Number(m[1]),
      total: Number(m[2]),
      warnings: Number(m[3]),
      errors: Number(m[4]),
    }
  }
  return undefined
}

/** 从引擎任意一行里抠进度：优先 x/y，其次百分比。 */
function parsePct(line: string): number | null {
  const frac = /(\d{1,4})\s*\/\s*(\d{1,4})/.exec(line)
  if (frac) {
    const a = Number(frac[1])
    const b = Number(frac[2])
    if (b > 0 && a <= b) return Math.round((a / b) * 100)
  }
  const pct = /(\d{1,3})\s*%/.exec(line)
  if (pct) {
    const p = Number(pct[1])
    if (p >= 0 && p <= 100) return p
  }
  return null
}

export interface RunOptions {
  url: string
  codec: string
  wrapperUrl: string
  settings: Settings
  workDir: string
  onLine?: (line: string) => void
  onProgress?: (pct: number) => void
  isCancelled?: () => boolean
  timeoutMs?: number
}

export async function runAppleEngine(opts: RunOptions): Promise<EngineResult> {
  if (!fs.existsSync(ENGINE_BIN)) {
    return { ok: false, tracks: [], error: `未找到 Apple 下载引擎二进制（${ENGINE_BIN}）` }
  }
  const configPath = path.join(opts.workDir, 'config.yaml')
  await fs.promises.mkdir(opts.workDir, { recursive: true })
  await fs.promises.writeFile(configPath, buildAppleConfig(opts.settings), 'utf8')

  const args = engineArgs(opts.url, opts.codec, configPath, opts.wrapperUrl)

  return new Promise<EngineResult>((resolve) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(ENGINE_BIN, args, {
        cwd: opts.workDir,
        env: { ...process.env, NO_COLOR: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (err) {
      resolve({ ok: false, tracks: [], error: `启动引擎失败：${err instanceof Error ? err.message : err}` })
      return
    }

    const outLines: string[] = []
    let stderrTail = ''
    let settled = false
    let lastPct = 0
    const deadline = Date.now() + (opts.timeoutMs ?? 3 * 3600_000)

    const finish = (r: EngineResult) => {
      if (settled) return
      settled = true
      clearInterval(timer)
      resolve(r)
    }

    const timer = setInterval(() => {
      if (opts.isCancelled?.()) {
        try {
          child.kill('SIGKILL')
        } catch {
          /* ignore */
        }
        finish({ ok: false, tracks: parseTracks(outLines), error: '已取消' })
      } else if (Date.now() > deadline) {
        try {
          child.kill('SIGKILL')
        } catch {
          /* ignore */
        }
        finish({ ok: false, tracks: parseTracks(outLines), error: '下载超时' })
      }
    }, 1500)

    const handle = (buf: Buffer, isErr: boolean) => {
      for (const raw of buf.toString('utf8').split(/\r?\n/)) {
        const line = raw.replace(/\u001b\[[0-9;]*m/g, '').trimEnd()
        if (!line) continue
        opts.onLine?.(line)
        if (isErr) {
          stderrTail = `${stderrTail}${line}\n`.slice(-4000)
        } else {
          outLines.push(line)
          if (outLines.length > 6000) outLines.shift()
          const pct = parsePct(line)
          if (pct !== null && pct > lastPct) {
            lastPct = pct
            opts.onProgress?.(pct)
          }
        }
      }
    }

    child.stdout?.on('data', (b: Buffer) => handle(b, false))
    child.stderr?.on('data', (b: Buffer) => handle(b, true))
    child.on('error', (err) => finish({ ok: false, tracks: [], error: `引擎错误：${err.message}` }))
    child.on('close', (code) => {
      const tracks = parseTracks(outLines)
      const summary = parseSummary(outLines)
      if (code === 0) {
        finish({ ok: true, tracks, summary })
        return
      }
      const hint = stderrTail.trim().split('\n').slice(-6).join('\n')
      finish({
        ok: false,
        tracks,
        summary,
        error: `引擎退出码 ${code}${hint ? `\n${hint}` : ''}`,
      })
    })
  })
}
