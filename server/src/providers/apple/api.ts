import { getSettings } from '../../settings.js'
import { HttpError } from '../../util/http.js'
import type { AlbumDetail, AlbumSummary, ArtistDetail, ArtistSummary, Quality, Track } from '../../types.js'

/**
 * Apple Music 目录客户端（只读）。
 *
 * Apple 的网页播放器用一个公开的开发者 JWT 调 `amp-api.music.apple.com`：
 *   1. 抓 https://music.apple.com 首页，找到 /assets/index~*.js
 *   2. 抓该 bundle，正则提取 JWT（优先 kid=WebPlayKid 的 web-player token）
 *   3. 以 Bearer 调 /v1/catalog/{storefront}/...
 * 这个 token 不是账号凭据，会轮换；失败时重新抓一次即可。
 *
 * 真正的音频下载不在这里做 —— 交给本地 AMDL 栈（FairPlay 解密），见 amdl.ts。
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const AMP = 'https://amp-api.music.apple.com'
const TOKEN_TTL = 6 * 3600_000

let tokenCache: { token: string; at: number } | null = null

function isWebPlayToken(jwt: string): boolean {
  try {
    const header = JSON.parse(Buffer.from(jwt.split('.')[0] ?? '', 'base64url').toString('utf8')) as { kid?: string }
    return header.kid === 'WebPlayKid'
  } catch {
    return false
  }
}

async function fetchToken(): Promise<string> {
  const idx = await fetch('https://music.apple.com', { headers: { 'user-agent': UA, accept: 'text/html' } })
  if (!idx.ok) throw new HttpError(`music.apple.com 返回 ${idx.status}`, 502)
  const html = await idx.text()
  const asset = /\/assets\/index~[^/]+\.js/.exec(html)
  if (!asset) throw new HttpError('未在 Apple Music 首页找到前端 bundle', 502)
  const bundle = await fetch(`https://music.apple.com${asset[0]}`, {
    headers: { 'user-agent': UA, accept: 'application/javascript' },
  })
  if (!bundle.ok) throw new HttpError(`Apple Music bundle 返回 ${bundle.status}`, 502)
  const js = await bundle.text()
  const list = [...new Set(js.match(/eyJ[A-Za-z0-9_=-]+\.[A-Za-z0-9_=-]+\.[A-Za-z0-9_=-]+/g) ?? [])]
  if (!list.length) throw new HttpError('Apple Music 前端 token 提取失败', 502)
  list.sort((a, b) => Number(isWebPlayToken(b)) - Number(isWebPlayToken(a)))
  return list[0]
}

async function token(force = false): Promise<string> {
  if (!force && tokenCache && Date.now() - tokenCache.at < TOKEN_TTL) return tokenCache.token
  const t = await fetchToken()
  tokenCache = { token: t, at: Date.now() }
  return t
}

async function apiGet(pathname: string, params: Record<string, string> = {}): Promise<any> {
  const sf = (getSettings().appleStorefront || 'cn').toLowerCase()
  const url = new URL(AMP + pathname)
  url.searchParams.set('l', 'zh-CN')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  let last = 0
  for (let attempt = 0; attempt < 3; attempt++) {
    const t = await token(attempt > 0)
    let res: Response
    try {
      res = await fetch(url, {
        headers: {
          authorization: `Bearer ${t}`,
          origin: 'https://music.apple.com',
          'user-agent': UA,
          accept: 'application/json',
        },
      })
    } catch (err) {
      throw new HttpError(`Apple Music 目录请求失败：${err instanceof Error ? err.message : err}`, 502)
    }
    if (res.status === 401 || res.status === 403) {
      last = res.status
      tokenCache = null
      continue
    }
    if (res.status === 404) return null
    if (!res.ok) throw new HttpError(`Apple Music 目录返回 ${res.status}`, 502)
    return res.json()
  }
  throw new HttpError(`Apple Music 目录鉴权失败（last ${last}）`, 502)
}

function artSize(template: string, size: number): string {
  if (!template) return ''
  return template.replace('{w}', String(size)).replace('{h}', String(size))
}

function albumIdFromUrl(u: string): string {
  const m = /\/(?:album|song)\/[^/]+\/(\d+)/.exec(u || '')
  return m ? m[1] : ''
}

function mapSong(item: any): Track {
  const a = item?.attributes || {}
  const url = String(a.url || '')
  return {
    provider: 'apple',
    id: String(item?.id || a.playParams?.catalogId || ''),
    title: String(a.name || '(untitled)'),
    artists: [String(a.artistName || '未知歌手')],
    album: String(a.albumName || ''),
    albumId: albumIdFromUrl(url),
    durationMs: Number(a.durationInMillis || 0),
    cover: artSize(a.artwork?.url || '', 800),
    trackNo: Number(a.trackNumber || 0) || undefined,
    year: String(a.releaseDate || '').slice(0, 4) || undefined,
    qualities: ['flac'],
    sourceUrl: url,
    previewUrl: a.previews?.[0]?.url ? String(a.previews[0].url) : undefined,
    traits: Array.isArray(a.audioTraits) ? a.audioTraits.map(String) : undefined,
  }
}

/** 专辑/歌单曲目：补上 artistMids（用于点进艺术家页）。 */
function withArtists(tracks: Track[], artistId?: string): Track[] {
  if (!artistId) return tracks
  return tracks.map((t) => ({ ...t, artistMids: [artistId] }))
}

function mapAlbum(item: any): AlbumSummary {
  const a = item?.attributes || {}
  return {
    id: String(item?.id || ''),
    name: String(a.name || '(untitled)'),
    artist: String(a.artistName || ''),
    cover: artSize(a.artwork?.url || '', 800),
    year: String(a.releaseDate || '').slice(0, 4) || undefined,
    trackCount: Number(a.trackCount || 0) || undefined,
    hasAtmos: Array.isArray(a.audioTraits) ? a.audioTraits.includes('atmos') : undefined,
  }
}

export async function searchSongs(keyword: string, page = 1): Promise<Track[]> {
  const sf = (getSettings().appleStorefront || 'cn').toLowerCase()
  const j = await apiGet(`/v1/catalog/${sf}/search`, {
    term: keyword,
    types: 'songs',
    limit: '25',
    offset: String((Math.max(1, page) - 1) * 25),
  })
  return (j?.results?.songs?.data || []).map(mapSong).filter((t: Track) => t.id)
}

export async function searchAlbums(keyword: string): Promise<AlbumSummary[]> {
  const sf = (getSettings().appleStorefront || 'cn').toLowerCase()
  const j = await apiGet(`/v1/catalog/${sf}/search`, { term: keyword, types: 'albums', limit: '25' })
  return (j?.results?.albums?.data || []).map(mapAlbum).filter((a: AlbumSummary) => a.id)
}

export async function searchArtists(keyword: string): Promise<ArtistSummary[]> {
  const sf = (getSettings().appleStorefront || 'cn').toLowerCase()
  const j = await apiGet(`/v1/catalog/${sf}/search`, { term: keyword, types: 'artists', limit: '25' })
  return (j?.results?.artists?.data || []).map((item: any) => ({
    id: String(item?.id || ''),
    name: String(item?.attributes?.name || ''),
    avatar: artSize(item?.attributes?.artwork?.url || '', 300),
  }))
}

export async function getAlbumDetail(id: string): Promise<AlbumDetail> {
  const sf = (getSettings().appleStorefront || 'cn').toLowerCase()
  const j = await apiGet(`/v1/catalog/${sf}/albums/${encodeURIComponent(id)}`, { include: 'tracks,artists' })
  const item = j?.data?.[0]
  if (!item) throw new HttpError('Apple Music 专辑不存在', 404)
  const a = item.attributes || {}
  const artistId = item.relationships?.artists?.data?.[0]?.id ? String(item.relationships.artists.data[0].id) : undefined
  const tracks: Track[] = withArtists(
    (item.relationships?.tracks?.data || [])
      .filter((t: any) => /^\d+$/.test(String(t?.id || '')))
      .map(mapSong),
    artistId,
  )
  return {
    id: String(item.id || id),
    artistId,
    url: String(a.url || ''),
    name: String(a.name || ''),
    artist: String(a.artistName || ''),
    cover: artSize(a.artwork?.url || '', 800),
    year: String(a.releaseDate || '').slice(0, 4) || undefined,
    trackCount: tracks.length || Number(a.trackCount || 0) || undefined,
    genre: Array.isArray(a.genreNames) ? a.genreNames.join(' / ') : '',
    desc: String(a.description?.standard || ''),
    tracks,
  }
}

export async function getArtistDetail(id: string): Promise<ArtistDetail> {
  const sf = (getSettings().appleStorefront || 'cn').toLowerCase()
  const j = await apiGet(`/v1/catalog/${sf}/artists/${encodeURIComponent(id)}`, { include: 'albums,songs' })
  const item = j?.data?.[0]
  const a = item?.attributes || {}
  const albums: AlbumSummary[] = (item?.relationships?.albums?.data || []).map(mapAlbum)
  const artistId = String(id)
  const songs: Track[] = withArtists(
    (item?.relationships?.songs?.data || []).map(mapSong),
    artistId,
  )
  return {
    id: artistId,
    name: String(a.name || id),
    avatar: artSize(a.artwork?.url || '', 300),
    songCount: songs.length,
    albumCount: albums.length,
    songs,
    albums,
  }
}

/** 歌单详情（pl.xxx）→ AlbumDetail 结构，复用专辑页展示与「全部下载」。 */
export async function getPlaylistDetail(id: string): Promise<AlbumDetail> {
  const sf = (getSettings().appleStorefront || 'cn').toLowerCase()
  const j = await apiGet(`/v1/catalog/${sf}/playlists/${encodeURIComponent(id)}`, { include: 'tracks' })
  const item = j?.data?.[0]
  if (!item) throw new HttpError('Apple Music 歌单不存在', 404)
  const a = item.attributes || {}
  const tracks: Track[] = (item.relationships?.tracks?.data || [])
    .filter((t: any) => /^\d+$/.test(String(t?.id || '')))
    .map(mapSong)
  // 补齐每首歌的艺人 id（歌单曲目来自不同艺人，供前端点艺术家名穿透）
  await resolveMany(tracks.map((t) => t.artists[0]))
  for (const t of tracks) {
    const aid = artistIdCache.get(t.artists[0])
    if (aid) t.artistMids = [aid]
  }
  return {
    id: String(item.id || id),
    url: String(a.url || ''),
    name: String(a.name || ''),
    artist: String(a.curatorName || a.artistName || ''),
    cover: artSize(a.artwork?.url || '', 800),
    year: String(a.releaseDate || '').slice(0, 4) || undefined,
    trackCount: tracks.length,
    genre: Array.isArray(a.genreNames) ? a.genreNames.join(' / ') : '',
    desc: String(a.description?.standard || ''),
    tracks,
  }
}

export async function getPlaylist(id: string): Promise<{ name: string; tracks: Track[] }> {
  const pl = await getPlaylistDetail(id)
  return { name: pl.name, tracks: pl.tracks }
}

const artistIdCache = new Map<string, string | null>()

/** 按艺人名解析 Apple 艺人 id（榜单数据本身不带 id），带内存缓存。 */
async function resolveArtistId(name: string): Promise<string | undefined> {
  const key = String(name || '').trim()
  if (!key) return undefined
  if (artistIdCache.has(key)) return artistIdCache.get(key) ?? undefined
  const sf = (getSettings().appleStorefront || 'cn').toLowerCase()
  try {
    const j = await apiGet(`/v1/catalog/${sf}/search`, { term: key, types: 'artists', limit: '1' })
    const id = j?.results?.artists?.data?.[0]?.id
    artistIdCache.set(key, id ? String(id) : null)
    return id ? String(id) : undefined
  } catch {
    artistIdCache.set(key, null)
    return undefined
  }
}

async function resolveMany(names: string[]): Promise<void> {
  const uniq = [...new Set(names.filter(Boolean))]
  const batch = 8
  for (let i = 0; i < uniq.length; i += batch) {
    await Promise.all(uniq.slice(i, i + batch).map((n) => resolveArtistId(n)))
  }
}

export interface AppleCharts {
  albums: AlbumSummary[]
  playlists: AlbumSummary[]
  spatialPlaylists: AlbumSummary[]
  songs: Track[]
}

function mapPlaylist(item: any): AlbumSummary {
  return {
    id: String(item?.id || ''),
    name: String(item?.attributes?.name || ''),
    artist: String(item?.attributes?.curatorName || ''),
    cover: artSize(item?.attributes?.artwork?.url || '', 800),
    trackCount: Number(item?.attributes?.trackCount || 0) || undefined,
    hasAtmos: Array.isArray(item?.attributes?.audioTraits) ? item.attributes.audioTraits.includes('atmos') : undefined,
  }
}

/** 首页榜单：热门专辑 / 热门歌单 / 热门歌曲。 */
export async function getCharts(): Promise<AppleCharts> {
  const sf = (getSettings().appleStorefront || 'cn').toLowerCase()
  const j = await apiGet(`/v1/catalog/${sf}/charts`, { types: 'albums,playlists,songs', limit: '20' })
  const r = j?.results || {}
  const spatial = await apiGet(`/v1/catalog/${sf}/search`, {
    term: '空间音频',
    types: 'playlists',
    limit: '10',
  }).catch(() => null)
  const albums = (r.albums?.[0]?.data || []).map(mapAlbum).filter((a: AlbumSummary) => a.id)
  const songs = (r.songs?.[0]?.data || []).map(mapSong)

  // 回填艺人 id：榜单数据不含 artistId，用艺人名解析（去重 + 缓存 + 并发）
  const names = new Set<string>()
  albums.forEach((a: AlbumSummary) => a.artist && names.add(a.artist))
  songs.forEach((s: Track) => s.artists[0] && names.add(s.artists[0]))
  await resolveMany([...names])
  for (const a of albums) a.artistId = artistIdCache.get(a.artist) ?? undefined
  for (const s of songs) {
    const id = artistIdCache.get(s.artists[0])
    if (id) s.artistMids = [id]
  }

  return {
    albums,
    playlists: (r.playlists?.[0]?.data || []).map(mapPlaylist).filter((p: AlbumSummary) => p.id),
    spatialPlaylists: (spatial?.results?.playlists?.data || []).map(mapPlaylist).filter((p: AlbumSummary) => p.id),
    songs,
  }
}

export async function getUserPlaylists(): Promise<{ id: string; name: string; cover: string; count: number }[]> {
  return []
}

/**
 * 不走 kmusic 原生 getUrl 下载链路：Apple 音频必须由 AMDL 引擎（FairPlay 解密）落盘。
 * 抛错信息会直接显示在任务失败原因里。
 */
export async function getUrl(_trackId: string, _quality: Quality): Promise<never> {
  throw new HttpError('Apple Music 由本地 AMDL 引擎下载，不经过直链取流', 400)
}
