import { fetchJson, HttpError, sleep, UA } from '../../util/http.js'
import { resizeCover } from '../../util/covers.js'
import type { AlbumDetail, AlbumSummary, ArtistDetail, ArtistSummary, Quality, Track } from '../../types.js'

const BASE = (process.env.NETEASE_API_URL || 'http://127.0.0.1:3011').replace(/\/$/, '')

async function call<T = any>(path: string, params: Record<string, string | number> = {}, cookie?: string): Promise<T> {
  const url = new URL(BASE + path)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v))
  if (cookie) url.searchParams.set('cookie', cookie)
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fetchJson<T>(url.toString(), { headers: { 'User-Agent': UA } })
    } catch (err) {
      lastError = err
      await sleep(250 * (attempt + 1))
    }
  }
  throw lastError
}

function mapSong(s: any): Track {
  const artists = (s.ar || s.artists || []).map((a: any) => a.name).filter(Boolean)
  const album = s.al || s.album || {}
  return {
    provider: 'netease',
    id: String(s.id),
    title: s.name || '',
    artists: artists.length ? artists : ['未知歌手'],
    artistMids: (s.ar || s.artists || []).map((a: any) => String(a.id)),
    album: album.name || '',
    albumId: String(album.id || ''),
    durationMs: Number(s.dt || s.duration || 0),
    cover: resizeCover(album.picUrl || s.picUrl || '', 800),
    trackNo: Number(s.no || 0) || undefined,
    year: s.publishTime ? String(new Date(s.publishTime).getFullYear()) : undefined,
    qualities: ['flac', '320', '128'],
    vipOnly: Number(s.fee) === 1,
  }
}

export async function searchSongs(keyword: string, page = 1, pageSize = 30): Promise<Track[]> {
  const data = await call<any>('/cloudsearch', { keywords: keyword, type: 1, limit: pageSize, offset: (page - 1) * pageSize })
  return (data?.result?.songs || []).map(mapSong)
}

export async function searchAlbums(keyword: string): Promise<AlbumSummary[]> {
  const data = await call<any>('/cloudsearch', { keywords: keyword, type: 10, limit: 30 })
  return (data?.result?.albums || []).map((a: any) => ({
    id: String(a.id),
    name: a.name,
    artist: a.artist?.name || a.artists?.[0]?.name || '',
    cover: resizeCover(a.picUrl || '', 300),
    year: a.publishTime ? String(new Date(a.publishTime).getFullYear()) : undefined,
    trackCount: Number(a.size || 0),
  }))
}

export async function searchArtists(keyword: string): Promise<ArtistSummary[]> {
  const data = await call<any>('/cloudsearch', { keywords: keyword, type: 100, limit: 30 })
  return (data?.result?.artists || []).map((a: any) => ({
    id: String(a.id),
    name: a.name,
    avatar: resizeCover(a.picUrl || '', 300),
    songCount: Number(a.musicSize || 0),
    albumCount: Number(a.albumSize || 0),
  }))
}

export async function getAlbumDetail(id: string): Promise<AlbumDetail> {
  const data = await call<any>('/album', { id })
  const album = data?.album
  if (!album) throw new HttpError('专辑不存在', 404)
  let songs = album.songs || []
  if (!songs.length && album.name) {
    const found = await call<any>('/cloudsearch', { keywords: album.name, type: 1, limit: 100 }).catch(() => null)
    songs = (found?.result?.songs || []).filter((s: any) => String(s.al?.id) === String(album.id))
  }
  return {
    id: String(album.id),
    name: album.name,
    artist: album.artist?.name || album.artists?.[0]?.name || '',
    cover: resizeCover(album.picUrl || '', 800),
    year: album.publishTime ? String(new Date(album.publishTime).getFullYear()) : undefined,
    trackCount: Number(album.size || songs.length),
    company: album.company || '',
    genre: (album.tags || []).join(' / '),
    desc: album.description || album.briefDesc || '',
    tracks: songs.map(mapSong),
  }
}

export async function getArtistDetail(id: string): Promise<ArtistDetail> {
  const [detail, songsData, albumsData] = await Promise.all([
    call<any>('/artist/detail', { id }).catch(() => null),
    call<any>('/artist/songs', { id, limit: 50, order: 'hot' }).catch(() => null),
    call<any>('/artist/album', { id, limit: 30 }).catch(() => null),
  ])
  const artist = detail?.data?.artist || {}
  const songs = (songsData?.songs || []).map(mapSong)
  const albums = (albumsData?.hotAlbums || []).map((a: any) => ({
    id: String(a.id),
    name: a.name,
    artist: a.artist?.name || artist.name || '',
    cover: resizeCover(a.picUrl || '', 300),
    year: a.publishTime ? String(new Date(a.publishTime).getFullYear()) : undefined,
    trackCount: Number(a.size || 0),
  }))
  return {
    id: String(id),
    name: artist.name || songs[0]?.artists[0] || '',
    avatar: resizeCover(artist.picUrl || artist.cover || '', 300),
    songCount: Number(songsData?.total || songs.length),
    albumCount: Number(albums.length),
    brief: artist.briefDesc || '',
    songs,
    albums,
  }
}

export async function getPlaylist(id: string, cookie?: string) {
  const data = await call<any>('/playlist/detail', { id, s: 0 }, cookie)
  const playlist = data?.playlist
  if (!playlist) throw new HttpError('歌单不存在', 404)
  let tracks = playlist.tracks || []
  const total = Number(playlist.trackCount || tracks.length)
  if (tracks.length < total) {
    const all = await call<any>('/playlist/track/all', { id, limit: 1000, offset: 0 }, cookie).catch(() => null)
    if (all?.songs?.length) tracks = all.songs
  }
  return {
    id: String(id),
    name: playlist.name || '',
    cover: resizeCover(playlist.coverImgUrl || '', 300),
    creator: playlist.creator?.nickname || '',
    tracks: tracks.map(mapSong),
  }
}

export async function getUserPlaylists(uid: string, cookie: string) {
  const data = await call<any>('/user/playlist', { uid, limit: 1000 }, cookie)
  return (data?.playlist || []).map((p: any) => ({
    id: String(p.id),
    name: p.name,
    cover: resizeCover(p.coverImgUrl || '', 300),
    count: Number(p.trackCount || 0),
    dirid: Number(p.specialType || 0),
  }))
}

export async function getProfile(cookie: string) {
  const data = await call<any>('/user/account', {}, cookie)
  const profile = data?.profile || {}
  const account = data?.account || {}
  if (!account.id) throw new HttpError('Cookie 已失效，请重新登录', 401)
  return {
    uid: String(account.id),
    nickname: profile.nickname || `网易云 ${account.id}`,
    avatar: profile.avatarUrl || '',
    vip: Number(profile.vipType || 0) > 0 ? 1 : 0,
  }
}

const LEVEL: Record<Quality, string> = { hires: 'hires', flac: 'lossless', '320': 'exhigh', '128': 'standard' }

export async function getUrl(id: string, quality: Quality, cookie?: string) {
  const data = await call<any>('/song/url/v1', { id, level: LEVEL[quality] }, cookie)
  const item = data?.data?.[0]
  if (!item?.url) return null
  const type = String(item.type || '').toLowerCase()
  const br = Number(item.br || item.bitrate || 0)
  const ext = type.includes('flac') ? 'flac' : 'mp3'
  let actual: Quality
  if (ext === 'flac') actual = br >= 1_411_200 ? 'hires' : 'flac'
  else actual = br >= 320_000 ? '320' : '128'
  return { url: item.url as string, ext, quality: actual }
}

export async function getLyric(id: string): Promise<string | null> {
  const data = await call<any>('/lyric', { id })
  const lyric = data?.lrc?.lyric || ''
  return lyric.trim() ? lyric : null
}

export async function qrCreate() {
  const keyData = await call<any>('/login/qr/key', { timestamp: Date.now() })
  const key = keyData?.data?.unikey
  if (!key) throw new HttpError('获取二维码失败', 502)
  const qr = await call<any>('/login/qr/create', { key, qrimg: 'true' })
  return { key, qrimg: qr?.data?.qrimg || '' }
}

export async function qrCheck(key: string) {
  const data = await call<any>('/login/qr/check', { key, timestamp: Date.now() })
  return { code: Number(data?.code || 0), message: data?.message || '', cookie: data?.cookie as string | undefined }
}
