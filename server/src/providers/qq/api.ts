import { fetchJson, HttpError, UA } from '../../util/http.js'
import type { AlbumDetail, AlbumSummary, ArtistDetail, Quality, Track } from '../../types.js'

const QQ_HEADERS = {
  Referer: 'https://y.qq.com/',
  Origin: 'https://y.qq.com',
}

const MUSICU = 'https://u.y.qq.com/cgi-bin/musicu.fcg'

export function coverUrl(albumMid: string, size = 800) {
  if (!albumMid) return ''
  return `https://y.gtimg.cn/music/photo_new/T002R${size}x${size}M000${albumMid}.jpg`
}

export function parseCookie(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of raw.split(/;\s*/)) {
    const idx = part.indexOf('=')
    if (idx <= 0) continue
    const key = part.slice(0, idx).trim()
    const value = part.slice(idx + 1).trim()
    if (key) out[key] = value
  }
  return out
}

export function getUinFromCookie(raw: string): string {
  const c = parseCookie(raw)
  return String(c.uin || c.wxuin || '').replace(/\D/g, '')
}

export function normalizeCookie(raw: string): string {
  return raw
    .replace(/\r?\n/g, '; ')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .join('; ')
}

function qualitiesOf(file: Record<string, number> = {}): Quality[] {
  const out: Quality[] = []
  if (Number(file.size_hires) > 0) out.push('hires')
  if (Number(file.size_flac) > 0) out.push('flac')
  if (Number(file.size_320mp3 ?? file.size_320) > 0) out.push('320')
  if (Number(file.size_128mp3 ?? file.size_128) > 0) out.push('128')
  if (!out.length) out.push('128')
  return out
}

export function mapSong(s: any): Track {
  const artists = (s.singer || []).map((x: any) => x.name).filter(Boolean)
  const albumMid = s.album?.mid || s.albummid || ''
  const file = s.file || {
    size_flac: s.sizeflac,
    size_320mp3: s.size320,
    size_128mp3: s.size128,
    size_ape: s.sizeape,
  }
  return {
    provider: 'qq',
    id: s.mid || s.songmid,
    title: s.name || s.songname || '',
    artists: artists.length ? artists : ['未知歌手'],
    album: s.album?.name || s.albumname || '',
    albumId: albumMid,
    durationMs: Number(s.interval || 0) * 1000,
    cover: coverUrl(albumMid),
    trackNo: Number(s.index_album || 0) || undefined,
    mediaMid: s.file?.media_mid || s.file?.strMediaMid || undefined,
    artistMids: (s.singer || []).map((x: any) => x.mid).filter(Boolean),
    hires: Number(file.size_hires) > 0,
    year: (s.time_public || '').slice(0, 4) || undefined,
    qualities: qualitiesOf(file),
    vipOnly: Number(s.pay?.pay_play) === 1 || Number(s.pay?.payplay) === 1,
    payPlay: Number(s.pay?.pay_play || 0),
  }
}

export async function search(keyword: string, page = 1, pageSize = 30): Promise<Track[]> {
  const url = new URL('https://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp')
  url.searchParams.set('p', String(page))
  url.searchParams.set('n', String(pageSize))
  url.searchParams.set('w', keyword)
  url.searchParams.set('format', 'json')
  url.searchParams.set('new_json', '1')
  url.searchParams.set('cr', '1')
  url.searchParams.set('t', '0')
  const data = await fetchJson<any>(url.toString(), { headers: QQ_HEADERS })
  const list = data?.data?.song?.list || []
  return list.map(mapSong)
}

export interface VkeyResult {
  url: string
  quality: Quality
  ext: string
}

const FILENAME: Record<Quality, (mid: string) => string> = {
  hires: (mid) => `Q000${mid}.flac`,
  flac: (mid) => `F000${mid}.flac`,
  '320': (mid) => `M800${mid}.mp3`,
  '128': (mid) => `M500${mid}.mp3`,
}

export async function getVkey(
  mid: string,
  quality: Quality,
  opts: { cookie?: string; uin?: string; mediaMid?: string } = {},
): Promise<VkeyResult | null> {
  const candidates = [...new Set([opts.mediaMid, mid].filter(Boolean))] as string[]
  for (const candidate of candidates) {
    const result = await requestVkey(mid, candidate, quality, opts)
    if (result) return result
  }
  return null
}

async function requestVkey(
  mid: string,
  fileMid: string,
  quality: Quality,
  opts: { cookie?: string; uin?: string },
): Promise<VkeyResult | null> {
  const uin = (opts.uin || '').replace(/\D/g, '') || '0'
  const filename = FILENAME[quality](fileMid)
  const payload = {
    req_0: {
      module: 'vkey.GetVkeyServer',
      method: 'CgiGetVkey',
      param: {
        guid: String(1000000000 + (Number(uin) % 900000000 || 123456789)),
        songmid: [mid],
        songtype: [0],
        uin,
        loginflag: 1,
        platform: '20',
        filename: [filename],
      },
    },
    comm: { uin: Number(uin) || 0, format: 'json', ct: 24, cv: 0 },
  }
  const url = `${MUSICU}?format=json&data=${encodeURIComponent(JSON.stringify(payload))}`
  const headers: Record<string, string> = { ...QQ_HEADERS }
  if (opts.cookie) headers.Cookie = opts.cookie
  const data = await fetchJson<any>(url, { headers })

  const req = data?.req_0
  const purl: string = req?.data?.midurlinfo?.[0]?.purl || ''
  if (!purl) return null
  const sip: string[] = req?.data?.sip || []
  const base = sip[0] || 'https://dl.stream.qqmusic.qq.com/'
  return { url: base + purl, quality, ext: quality === 'flac' ? 'flac' : 'mp3' }
}

export async function getLyric(mid: string): Promise<string | null> {
  const url = `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${encodeURIComponent(mid)}&format=json&nobase64=1`
  const data = await fetchJson<any>(url, {
    headers: { Referer: 'https://y.qq.com/portal/player.html', 'User-Agent': UA },
  })
  const lyric = typeof data?.lyric === 'string' ? data.lyric : ''
  return lyric.trim() ? lyric : null
}

export interface QqPlaylist {
  id: string
  name: string
  cover: string
  creator: string
  tracks: Track[]
}

export function gtkFromCookie(cookie: string): number {
  const c = parseCookie(cookie)
  const key = c.p_skey || c.skey || c.qqmusic_key || c.qm_keyst || ''
  let n = 5381
  for (let i = 0; i < key.length; i++) n += (n << 5) + key.charCodeAt(i)
  return 2147483647 & n
}

export async function getPlaylist(
  disstid: string,
  opts: { cookie?: string; uin?: string } = {},
): Promise<QqPlaylist> {
  // 带登录态时用旧接口，可读取「我喜欢」(dirid=201)
  if (opts.cookie) {
    const g = gtkFromCookie(opts.cookie)
    const uin = (opts.uin || '').replace(/\D/g, '') || '0'
    const url =
      'https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg' +
      `?type=1&json=1&utf8=1&onlysong=0&disstid=${encodeURIComponent(disstid)}` +
      `&format=json&g_tk=${g}&loginUin=${uin}&hostUin=0&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0`
    try {
      const data = await fetchJson<any>(url, { headers: { ...QQ_HEADERS, Cookie: opts.cookie } })
      const cd = data?.cdlist?.[0]
      if (cd) {
        return {
          id: String(disstid),
          name: cd.dissname || cd.diss_name || '',
          cover: cd.logo || '',
          creator: cd.nickname || '',
          tracks: (cd.songlist || []).map((s: any, i: number) =>
            mapAlbumSong(s, { name: cd.dissname, mid: '', aDate: '', singername: cd.nickname }, i),
          ),
        }
      }
    } catch {
      /* 落到新接口 */
    }
  }

  const payload = {
    comm: { ct: 24, cv: 0 },
    req_0: {
      module: 'music.srfDissInfo.aiDissInfo',
      method: 'uniform_get_Dissinfo',
      param: { disstid: Number(disstid), enc_host_uin: '', tag: 1, userinfo: 1, song_begin: 0, song_num: 500 },
    },
  }
  const url = `${MUSICU}?format=json&data=${encodeURIComponent(JSON.stringify(payload))}`
  const data = await fetchJson<any>(url, { headers: QQ_HEADERS })
  const d = data?.req_0?.data
  if (!d?.dirinfo) throw new HttpError('歌单不存在或未公开', 404)
  return {
    id: String(disstid),
    name: d.dirinfo.title || '',
    cover: d.dirinfo.picurl || '',
    creator: d.dirinfo.nickname || '',
    tracks: (d.songlist || []).map((s: any, i: number) => mapAlbumSong(s, { name: d.dirinfo.title, mid: '', aDate: '' }, i)),
  }
}

export interface QqUserPlaylist {
  id: string
  name: string
  cover: string
  count: number
  dirid: number
}

export async function getUserPlaylists(uin: string, cookie?: string): Promise<QqUserPlaylist[]> {
  const url =
    'https://c.y.qq.com/rsc/fcgi-bin/fcg_user_created_diss' +
    `?hostuin=${encodeURIComponent(uin)}&sin=0&size=200&format=json` +
    '&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0&g_tk=5381&loginUin=0'
  const headers: Record<string, string> = { ...QQ_HEADERS }
  if (cookie) headers.Cookie = cookie
  const data = await fetchJson<any>(url, { headers })
  if (Number(data?.code) === 4000) return []
  const list = data?.data?.disslist || []
  return list.map((d: any) => ({
    id: String(d.tid || d.dissid || ''),
    name: d.diss_name || d.dissname || '',
    cover: d.diss_cover || '',
    count: Number(d.song_cnt || 0),
    dirid: Number(d.dirid || 0),
  }))
}

export async function getProfile(cookie: string, uin: string) {
  const url =
    'https://c.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg' +
    `?cid=205360838&userid=${encodeURIComponent(uin)}&reqfrom=1&format=json`
  // 用原生 fetch 以便拿到 Set-Cookie（QQ 会在响应里轮换 qqmusic_key / p_skey）
  const res = await fetch(url, { headers: { ...QQ_HEADERS, Cookie: cookie } })
  if (!res.ok) throw new HttpError(`上游返回 ${res.status}`, 502)
  const data: any = await res.json()
  if (Number(data?.code) === 1000) throw new HttpError('Cookie 已失效，请重新登录', 401)
  const d = data?.data || {}
  const rawSetCookie = (res.headers as any).getSetCookie?.() ?? []
  const setCookie: string[] = Array.isArray(rawSetCookie) ? rawSetCookie : []
  return {
    nickname: d.hostname || d.nickname || `QQ ${uin}`,
    avatar: d.headpic || d.avatar || '',
    vip: Number(d.vip?.vip_type || d.vip_type || 0),
    setCookie,
    raw: d,
  }
}


function mapAlbumSong(s: any, album: any, index: number): Track {
  const artists = (s.singer || []).map((x: any) => x.name).filter(Boolean)
  const albumMid = s.albummid || album.mid
  const file = {
    size_flac: s.sizeflac,
    size_320mp3: s.size320,
    size_128mp3: s.size128,
    size_ape: s.sizeape,
    size_hires: s.size_hires,
  }
  return {
    provider: 'qq',
    id: s.songmid,
    title: s.songname,
    artists: artists.length ? artists : [album.singername || '未知歌手'],
    artistMids: (s.singer || []).map((x: any) => x.mid).filter(Boolean),
    album: s.albumname || album.name,
    albumId: albumMid,
    durationMs: Number(s.interval || 0) * 1000,
    cover: coverUrl(albumMid, 800),
    trackNo: index + 1,
    year: (album.aDate || '').slice(0, 4) || undefined,
    mediaMid: s.strMediaMid || undefined,
    qualities: qualitiesOf(file),
    hires: Number(file.size_hires) > 0,
    vipOnly: Number(s.pay?.pay_play || s.pay?.payplay) === 1,
    payPlay: Number(s.pay?.pay_play || 0),
  }
}

export async function searchAlbums(keyword: string): Promise<AlbumSummary[]> {
  const url =
    'https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg' +
    `?key=${encodeURIComponent(keyword)}&format=json&inCharset=utf8&outCharset=utf-8`
  const [smartbox, songs] = await Promise.all([
    fetchJson<any>(url, { headers: QQ_HEADERS }).catch(() => null),
    search(keyword, 1, 30).catch(() => [] as Track[]),
  ])
  const map = new Map<string, AlbumSummary>()
  for (const a of smartbox?.data?.album?.itemlist || []) {
    map.set(a.mid, { id: a.mid, name: a.name, artist: a.singer || '', cover: coverUrl(a.mid, 300) })
  }
  for (const song of songs) {
    if (song.albumId && song.album && !map.has(song.albumId)) {
      map.set(song.albumId, {
        id: song.albumId,
        name: song.album,
        artist: song.artists[0] || '',
        cover: coverUrl(song.albumId, 300),
        year: song.year,
        trackCount: undefined,
      })
    }
  }
  return [...map.values()].slice(0, 24)
}

export async function searchArtists(keyword: string): Promise<import('../../types.js').ArtistSummary[]> {
  const url =
    'https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg' +
    `?key=${encodeURIComponent(keyword)}&format=json&inCharset=utf8&outCharset=utf-8`
  const [smartbox, songs] = await Promise.all([
    fetchJson<any>(url, { headers: QQ_HEADERS }).catch(() => null),
    search(keyword, 1, 30).catch(() => [] as Track[]),
  ])
  const map = new Map<string, import('../../types.js').ArtistSummary>()
  for (const a of smartbox?.data?.singer?.itemlist || []) {
    map.set(a.mid, { id: a.mid, name: a.name, avatar: a.pic || '' })
  }
  for (const song of songs) {
    song.artistMids?.forEach((mid, i) => {
      if (!mid || map.has(mid)) return
      map.set(mid, {
        id: mid,
        name: song.artists[i] || song.artists[0] || '',
        avatar: `https://y.gtimg.cn/music/photo_new/T001R300x300M000${mid}.jpg`,
      })
    })
  }
  return [...map.values()].slice(0, 24)
}

export async function getAlbumDetail(albummid: string): Promise<AlbumDetail> {
  const url = `https://c.y.qq.com/v8/fcg-bin/fcg_v8_album_info_cp.fcg?albummid=${encodeURIComponent(albummid)}&format=json`
  const data = await fetchJson<any>(url, { headers: QQ_HEADERS })
  const d = data?.data
  if (!d) throw new HttpError('专辑不存在或未公开', 404)
  const tracks = (d.list || []).map((s: any, i: number) => mapAlbumSong(s, d, i))
  return {
    id: albummid,
    name: d.name || '',
    artist: d.singername || '',
    cover: coverUrl(albummid, 800),
    year: (d.aDate || '').slice(0, 4) || undefined,
    trackCount: Number(d.total || tracks.length),
    company: d.company || '',
    genre: d.genre || '',
    desc: d.desc || '',
    tracks,
  }
}

function mapSingerSong(s: any, index: number): Track {
  const album = s.album || {}
  return {
    provider: 'qq',
    id: s.mid,
    title: s.name || s.title || '',
    artists: (s.singer || []).map((x: any) => x.name).filter(Boolean),
    artistMids: (s.singer || []).map((x: any) => x.mid).filter(Boolean),
    album: album.name || '',
    albumId: album.mid || '',
    durationMs: Number(s.interval || 0) * 1000,
    cover: coverUrl(album.mid || '', 800),
    trackNo: index + 1,
    year: (album.time_public || '').slice(0, 4) || undefined,
    mediaMid: s.file?.media_mid || undefined,
    qualities: ['flac', '320', '128'],
    vipOnly: false,
  }
}

export async function getArtistDetail(singermid: string): Promise<ArtistDetail> {
  const payload = {
    comm: { ct: 24, cv: 0 },
    singer: {
      method: 'get_singer_detail_info',
      param: { sort: 5, singermid, sin: 0, num: 50 },
      module: 'music.web_singer_info_svr',
    },
    singerAlbum: {
      method: 'get_singer_album',
      param: { singermid, order: 'time', begin: 0, num: 24, exstatus: 1 },
      module: 'music.web_singer_info_svr',
    },
  }
  const url = `${MUSICU}?format=json&data=${encodeURIComponent(JSON.stringify(payload))}`
  const data = await fetchJson<any>(url, { headers: QQ_HEADERS })
  const info = data?.singer?.data || {}
  const songs = (info.songlist || []).map((s: any, i: number) => mapSingerSong(s, i))
  const albums = (data?.singerAlbum?.data?.list || []).map((a: any) => ({
    id: a.album_mid,
    name: a.album_name,
    artist: a.singer_name || '',
    cover: coverUrl(a.album_mid, 300),
    year: (a.pub_time || '').slice(0, 4),
  }))
  return {
    id: singermid,
    name: info.singer_info?.name || albums[0]?.artist || '',
    avatar: info.singer_info?.pic || `https://y.gtimg.cn/music/photo_new/T001R300x300M000${singermid}.jpg`,
    songCount: Number(info.total_song || songs.length),
    albumCount: Number(info.total_album || albums.length),
    brief: info.singer_brief || '',
    songs,
    albums,
  }
}
