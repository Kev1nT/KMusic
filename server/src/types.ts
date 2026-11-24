export type Quality = 'hires' | 'flac' | '320' | '128'

export const QUALITY_LABEL: Record<Quality, string> = {
  hires: 'Hi-Res 24bit',
  flac: '无损 FLAC',
  '320': '高品质 320K',
  '128': '标准 128K',
}

export const QUALITY_ORDER: Quality[] = ['hires', 'flac', '320', '128']

export interface Track {
  provider: string
  id: string
  title: string
  artists: string[]
  artistMids?: string[]
  album: string
  albumId: string
  durationMs: number
  cover: string
  trackNo?: number
  year?: string
  mediaMid?: string
  qualities: Quality[]
  hires?: boolean
  vipOnly?: boolean
  payPlay?: number
  /** 外部平台（Apple Music）的原始下载链接 */
  sourceUrl?: string
  /** Apple Music 试听片段（30s，未加密，可直接播放） */
  previewUrl?: string
  /** Apple 音频特性：lossless / hi-res-lossless / atmos / dolby-audio ... */
  traits?: string[]
  blocked?: boolean
  blockedBy?: string
}

export interface AlbumSummary {
  id: string
  name: string
  artist: string
  artistId?: string
  cover: string
  year?: string
  trackCount?: number
  hasAtmos?: boolean
}

export interface AlbumDetail extends AlbumSummary {
  artistId?: string
  /** 平台原始链接（Apple 整张下载用） */
  url?: string
  company?: string
  genre?: string
  desc?: string
  tracks: Track[]
}

export interface ArtistSummary {
  id: string
  name: string
  avatar: string
  songCount?: number
  albumCount?: number
}

export interface ArtistDetail extends ArtistSummary {
  brief?: string
  songs: Track[]
  albums: AlbumSummary[]
}

export interface AccountRow {
  id: number
  provider: string
  uid: string
  nickname: string
  alias: string
  library_path: string
  avatar: string
  vip: number
  cookie_enc: string
  is_default: number
  status: string
  last_check_at: string | null
  created_at: string
  updated_at: string
}

export interface AccountPublic {
  id: number
  provider: string
  uid: string
  nickname: string
  alias: string
  libraryPath: string
  avatar: string
  vip: number
  isDefault: boolean
  status: string
  lastCheckAt: string | null
  createdAt: string
}

export type TaskStatus = 'queued' | 'resolving' | 'downloading' | 'verifying' | 'tagging' | 'done' | 'failed' | 'canceled'

export interface TaskRow {
  id: number
  provider: string
  track_id: string
  title: string
  artists: string
  album: string
  album_id: string
  cover: string
  duration_ms: number
  track_no: number
  year: string
  media_mid: string
  source_url: string
  quality: string | null
  status: TaskStatus
  progress: number
  total_bytes: number
  received_bytes: number
  error: string | null
  file_path: string | null
  account_id: number | null
  created_at: string
  updated_at: string
}

export interface DownloadResult {
  url: string
  quality: Quality
  ext: string
  bitrate?: number
}
