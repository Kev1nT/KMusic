import { config } from './config.js'
import { getSetting, setSetting } from './db.js'
import type { Quality } from './types.js'

export interface Settings {
  libraryPath: string
  template: string
  quality: Quality
  coverSize: number
  blockWords: string[]
  hideBlocked: boolean
  fallback: boolean
  writeNfo: boolean
  writeLrc: boolean
  embedCover: boolean
  embedLyrics: boolean
  concurrency: number
  downloadAccountId: number | null
  // Apple Music：内置 apple-music-dl 引擎 + wrapper（FairPlay 解密）
  appleWrapperUrl: string
  appleAlacDir: string
  appleAtmosDir: string
  appleAacDir: string
  appleStorefront: string
  appleCodec: string
  appleDualDownload: boolean
  appleConvertFlac: boolean
  appleLyricType: string
  appleLyricFormat: string
  appleEmbedLyric: boolean
  appleSaveLrc: boolean
  appleCoverSize: string
}

export const DEFAULT_SETTINGS: Settings = {
  libraryPath: config.musicDir,
  template: '{artist}/{album}/{track:02d} - {title}',
  quality: 'flac',
  coverSize: 800,
  blockWords: ['伴奏', '消音', 'KTV', '铃声', '试听片段'],
  hideBlocked: false,
  fallback: true,
  writeNfo: true,
  writeLrc: true,
  embedCover: true,
  embedLyrics: true,
  concurrency: 2,
  downloadAccountId: null,
  appleWrapperUrl: 'http://127.0.0.1:12340',
  appleAlacDir: '/music/Apple/Lossless',
  appleAtmosDir: '/music/Apple/Atmos',
  appleAacDir: '/music/Apple/AAC',
  appleStorefront: 'cn',
  appleCodec: 'alac',
  appleDualDownload: true,
  appleConvertFlac: true,
  appleLyricType: 'syllable',
  appleLyricFormat: 'lrc',
  appleEmbedLyric: true,
  appleSaveLrc: true,
  appleCoverSize: '3000x3000',
}

export function getSettings(): Settings {
  return { ...DEFAULT_SETTINGS, ...getSetting<Partial<Settings>>('settings', {}) }
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch }
  setSetting('settings', next)
  return next
}
