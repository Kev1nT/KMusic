import { createRequire } from 'node:module'
import { db, getSetting, now, setSetting } from '../../db.js'
import { decrypt, encrypt } from '../../crypto.js'
import { HttpError } from '../../util/http.js'
import { upsertAccount } from '../../accountStore.js'
import type { AlbumDetail, AlbumSummary, ArtistDetail, ArtistSummary, Quality, Track } from '../../types.js'

const require = createRequire(import.meta.url)
const qs = require('qishui-music-api') as any

let apiInstance: any = null
let storeInstance: any = null

function currentRow(): any {
  return db.prepare("SELECT * FROM accounts WHERE provider = 'qishui' ORDER BY id ASC LIMIT 1").get()
}

function deviceId(): string {
  let id = getSetting<string>('qishui_device_id', '')
  if (!id) {
    id = qs.createQishuiDeviceId()
    setSetting('qishui_device_id', id)
  }
  return id
}

class DbSessionStore {
  deviceId = deviceId()
  revision = 0
  get() {
    const row = currentRow()
    if (!row) return null
    try {
      return JSON.parse(decrypt(row.cookie_enc)).session || null
    } catch {
      return null
    }
  }
  set(session: any) {
    const payload = JSON.stringify({ deviceId: this.deviceId, session })
    upsertAccount(
      'qishui',
      String(session.userId || session.user?.id || ''),
      {
        nickname: session.user?.nickname || `汽水 ${session.userId || ''}`,
        avatar: '',
        vip: session.user?.isVip ? 1 : 0,
      },
      payload,
    )
    this.revision += 1
  }
  clear() {
    const row = currentRow()
    if (row) db.prepare("UPDATE accounts SET status = 'invalid', updated_at = ? WHERE id = ?").run(now(), row.id)
    this.revision += 1
  }
}

function api() {
  if (!apiInstance) {
    storeInstance = new DbSessionStore()
    apiInstance = qs.createQishuiApi({ deviceId: storeInstance.deviceId, sessions: storeInstance })
  }
  return apiInstance
}

function coverUrl(cover: any): string {
  if (!cover) return ''
  if (typeof cover === 'string') return cover
  // 抖音图片需要签名模板，当前接口未给可用模板，先留空由前端兜底
  if (Array.isArray(cover.url_list) && cover.url_list.length) return cover.url_list[0]
  return ''
}

function mapTrack(item: any): Track {
  const base = item.base_info || {}
  const rel = item.related_info || {}
  const display = item.display_info || {}
  const artistLinks = Array.isArray(rel.artist_links) ? rel.artist_links : []
  const artists = artistLinks.map((a: any) => a.name).filter(Boolean)
  const album = rel.album_link || {}
  return {
    provider: 'qishui',
    id: String(base.id || item.id || ''),
    title: base.name || base.sub_name || '',
    artists: artists.length ? artists : ['未知歌手'],
    artistMids: artistLinks.map((a: any) => String(a.id)),
    album: album.name || '',
    albumId: String(album.id || ''),
    durationMs: Number(base.duration_ms || 0),
    cover: coverUrl(display.cover_url),
    trackNo: 0,
    year: album.release_date ? String(new Date(Number(album.release_date) * 1000).getFullYear()) : undefined,
    qualities: ['128'],
    vipOnly: false,
  }
}

async function requestAccount(operation: string, params: any = {}) {
  let result = await api().request(operation, params)
  if (!result?.ok && result?.error?.code === 'auth-required') {
    // 让库先尝试用 access code 刷新 ticket；刷新成功后再重试一次
    const refreshed = await api().request('login_status')
    if (refreshed?.ok) result = await api().request(operation, params)
  }
  return ensureOk(result)
}

function ensureOk(result: any) {
  if (!result?.ok) {
    const message = result?.error?.message || result?.error?.code || '汽水音乐接口失败'
    if (result?.error?.code === 'auth-required' || /rejected|auth|login|ticket|登录/i.test(message)) {
      throw new HttpError('汽水音乐登录已过期，请到账号页重新扫码', 400)
    }
    throw new HttpError(message, 502)
  }
  return result.data
}

export async function searchSongs(keyword: string, page = 1, pageSize = 30): Promise<Track[]> {
  const data = ensureOk(
    await api().request('search', { query: keyword, limit: pageSize, offset: (page - 1) * pageSize }),
  )
  return (data.items || []).map(mapTrack)
}

export async function searchAlbums(_keyword: string): Promise<AlbumSummary[]> {
  return []
}

export async function searchArtists(_keyword: string): Promise<ArtistSummary[]> {
  return []
}

export async function getAlbumDetail(_id: string): Promise<AlbumDetail> {
  throw new HttpError('汽水音乐暂不支持专辑详情', 400)
}

export async function getArtistDetail(id: string): Promise<ArtistDetail> {
  const detail = ensureOk(await api().request('artist_detail', { id }))
  const songsData = ensureOk(await api().request('artist_songs', { id, limit: 50, offset: 0 }))
  return {
    id,
    name: detail?.name || detail?.simple_display_name || '',
    avatar: coverUrl(detail?.avatar || detail?.url_avatar),
    songCount: Number(songsData?.total || 0),
    albumCount: 0,
    brief: detail?.description || '',
    songs: (songsData?.items || []).map(mapTrack),
    albums: [],
  }
}

const normKey = (s = '') => s.toLowerCase().replace(/[\s\-_·・.,，。'’"“”()（）\[\]【】\/]/g, '')
// 主标题：去掉括号里的版本说明（DJ版 / 氛围版 / Live …）
const mainTitle = (s = '') => normKey(String(s).replace(/[（(【\[].*?[)）】\]]/g, ''))

/** 曲目下架换 id 时，按「歌名 + 歌手」在汽水搜索里列出候选（按匹配度排序） */
export async function resolveCandidates(title: string, artists: string[]): Promise<Track[]> {
  const artist = artists[0] || ''
  const list = await searchSongs(`${title} ${artist}`.trim(), 1, 20).catch(() => [] as Track[])
  if (!list.length) return []
  const t = normKey(title)
  const a = normKey(artist)
  const tMain = mainTitle(title)
  const scored = list
    .map((x) => {
      const xt = normKey(x.title)
      const xtMain = mainTitle(x.title)
      const xa = normKey(x.artists[0] || '')
      // 必须是同一首歌：艺术家对不上的一律不采用（不能只因歌名相同就下别人的歌）
      if (!a || !xa || !(xa === a || xa.includes(a) || a.includes(xa))) return null
      let score = 0
      if (xt === t) score += 8
      else if (tMain && xtMain === tMain) score += 5
      else if (t.length > 3 && (xt.includes(t) || t.includes(xt))) score += 2
      else return null
      score += 4
      return { track: x, score }
    })
    .filter(Boolean) as { track: Track; score: number }[]
  scored.sort((x, y) => y.score - x.score)
  return scored.slice(0, 6).map((x) => x.track)
}

export async function getUrl(id: string, _quality: Quality): Promise<{ url: string; ext: string; quality?: Quality } | null> {
  // 车机接口只提供未加密的 standard；higher/lossless 是加密流，库无法解密
  let data: any
  try {
    data = ensureOk(await api().request('audio', { id, quality: 'standard' }))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/did not return the track|not-playable/i.test(msg)) {
      throw new HttpError('该曲目在汽水音乐已下架或不可播放，请重新搜索歌名后再试', 404)
    }
    if (/protected audio|decryption is disabled|unsupported/i.test(msg)) {
      throw new HttpError('该曲目只有加密音源，车机接口无法解密', 502)
    }
    throw err
  }
  if (!data?.url) return null
  if (data.preview) {
    const vip = Number(currentUser()?.isVip || 0) > 0
    throw new HttpError(
      vip
        ? '该曲目受版权/区域限制，汽水即便会员也只提供试听片段（与会员无关，建议换平台下载）'
        : '该曲目仅返回试听片段：需要汽水音乐会员，或该曲目受付费/版权限制',
      502,
    )
  }
  return { url: data.url, ext: 'm4a', quality: '128' as Quality }
}

export async function getLyric(id: string): Promise<string | null> {
  const data = ensureOk(await api().request('lyrics', { id }))
  const content = data?.lyric_entity?.content || ''
  if (!content) return null
  return content
    .split('\n')
    .map((line: string) => {
      const m = line.match(/^\[(\d+),\d+\](.*)$/)
      if (!m) return ''
      const start = Number(m[1])
      const text = m[2].replace(/<[^>]*>/g, '').trim()
      const mm = Math.floor(start / 60000)
      const ss = ((start % 60000) / 1000).toFixed(2).padStart(5, '0')
      return `[${mm}:${ss}]${text}`
    })
    .filter(Boolean)
    .join('\n')
}

export async function getUserPlaylists(_uid: string, _cookie?: string) {
  const data = await requestAccount('user_playlists', { limit: 200, offset: 0 })
  return (data.items || []).map((item: any) => {
    const base = item.base_info || {}
    const display = item.display_info || {}
    return {
      id: String(base.id || ''),
      name: base.name || base.title || '',
      cover: coverUrl(display.url_cover || base.cover_url),
      count: Number(item.resource_cnt?.track_cnt ?? item.resource_cnt?.media_count ?? base.track_count ?? 0),
      dirid: Number(base.type || 0),
      ownerId: String(base.owner_id || ''),
    }
  })
}

export async function getPlaylist(id: string, _cookie?: string) {
  const playlists = await getUserPlaylists('', '')
  const target = playlists.find((p: any) => p.id === id)
  // ownerId 取不到时传空，接口仍可读公开/自己的歌单
  const data = await requestAccount('playlist_tracks', { id, ownerId: target?.ownerId || '', limit: 500, offset: 0 })
  return {
    id,
    name: target?.name || '',
    cover: target?.cover || '',
    creator: '',
    tracks: (data.items || []).map(mapTrack),
  }
}

export async function qrStart() {
  const key = ensureOk(await api().request('login_qr_key'))
  const qr = ensureOk(await api().request('login_qr_create', { key: key.key }))
  return { key: key.key as string, qr: qr.imageUrl as string }
}

export async function qrCheck(key: string) {
  const data = ensureOk(await api().request('login_qr_check', { key }))
  return data as { state: string }
}

export async function getProfile() {
  await requestAccount('login_status')
  const user = currentUser()
  if (!user) throw new HttpError('汽水音乐未登录', 400)
  return user
}

export function currentUser() {
  const row = currentRow()
  if (!row) return null
  try {
    const parsed = JSON.parse(decrypt(row.cookie_enc))
    return parsed.session?.user || null
  } catch {
    return null
  }
}
