import { ref } from 'vue'

export type Quality = 'hires' | 'flac' | '320' | '128'

export interface Track {
  provider: string
  id: string
  title: string
  artists: string[]
  album: string
  albumId: string
  durationMs: number
  cover: string
  trackNo?: number
  year?: string
  mediaMid?: string
  artistMids?: string[]
  sourceUrl?: string
  previewUrl?: string
  traits?: string[]
  qualities: Quality[]
  hires?: boolean
  vipOnly?: boolean
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

export interface Account {
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

export interface Task {
  id: number
  provider: string
  track_id: string
  title: string
  artists: string
  album: string
  album_id: string
  cover: string
  duration_ms: number
  media_mid: string
  quality: string | null
  status: string
  progress: number
  total_bytes: number
  received_bytes: number
  error: string | null
  file_path: string | null
  created_at: string
  updated_at: string
}

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

const TOKEN_KEY = 'sq_token'

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || ''
}

export function setToken(token: string) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
  }
}

export const apiPending = ref(0)

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const trackPending = !path.startsWith('/tasks') && !path.startsWith('/dashboard') && !path.startsWith('/stats')
  if (trackPending) apiPending.value += 1
  const headers = new Headers(init.headers)
  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')

  let res: Response
  let text: string
  try {
    res = await fetch(`/api${path}`, { ...init, headers })
    text = await res.text()
  } finally {
    if (trackPending) apiPending.value = Math.max(0, apiPending.value - 1)
  }
  let data: any = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/login') && !path.startsWith('/accounts')) {
      setToken('')
      if (location.pathname !== '/login') location.href = '/login'
    }
    throw new ApiError(data?.error || `请求失败（${res.status}）`, res.status)
  }
  return data as T
}

export const QUALITY_LABEL: Record<Quality, string> = {
  hires: 'Hi-Res 24bit',
  flac: '无损 FLAC',
  '320': '320K',
  '128': '128K',
}


/** 批量判断曲目是否已下载（媒体库命中或本应用已下过） */
export async function checkDownloaded(
  items: { provider: string; id: string; title: string; artists: string[] }[],
): Promise<string[]> {
  if (!items.length) return []
  const r = await api<{ results: { provider: string; id: string; downloaded: boolean }[] }>('/library/check', {
    method: 'POST',
    body: JSON.stringify({ items }),
  })
  return r.results.filter((x) => x.downloaded).map((x) => `${x.provider}:${x.id}`)
}
