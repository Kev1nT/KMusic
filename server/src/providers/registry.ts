import {
  getAlbumDetail,
  getArtistDetail,
  getLyric,
  getPlaylist,
  getProfile,
  getUinFromCookie,
  getVkey,
  getUserPlaylists,
  search,
  searchAlbums,
  searchArtists,
} from './qq/api.js'
import * as ne from './netease/api.js'
import * as qs from './qishui/api.js'
import * as ap from './apple/api.js'
import type { AlbumDetail, AlbumSummary, ArtistDetail, ArtistSummary, Quality, Track } from '../types.js'

export interface ProviderAccount {
  cookie: string
  uin: string
}

export interface Provider {
  id: string
  name: string
  color: string
  search: (keyword: string, page: number) => Promise<Track[]>
  searchAlbums: (keyword: string) => Promise<AlbumSummary[]>
  searchArtists: (keyword: string) => Promise<ArtistSummary[]>
  album: (id: string) => Promise<AlbumDetail>
  artist: (id: string) => Promise<ArtistDetail>
  getUrl: (
    track: Track,
    quality: Quality,
    account?: ProviderAccount,
  ) => Promise<{ url: string; ext: string; quality?: Quality } | null>
  lyric: (track: Track) => Promise<string | null>
  playlist: (id: string, account?: ProviderAccount) => Promise<{ name: string; tracks: Track[] }>
  userPlaylists: (uin: string, account?: ProviderAccount) => Promise<{ id: string; name: string; cover: string; count: number }[]>
  profile: (account: ProviderAccount) => Promise<{ nickname: string; avatar: string; vip: number; setCookie?: string[] }>
  /** 曲目失效（如下架换 id）时，按元数据重新匹配一版 */
  repair?: (track: import('../types.js').Track) => Promise<import('../types.js').Track[]>
}

export const qqProvider: Provider = {
  id: 'qq',
  name: 'QQ 音乐',
  color: '#31c27c',
  search: (keyword, page) => search(keyword, page),
  searchAlbums: (keyword) => searchAlbums(keyword),
  searchArtists: (keyword) => searchArtists(keyword),
  album: (id) => getAlbumDetail(id),
  artist: (id) => getArtistDetail(id),
  async getUrl(track, quality, account) {
    const res = await getVkey(track.id, quality, { cookie: account?.cookie, uin: account?.uin, mediaMid: track.mediaMid })
    return res ? { url: res.url, ext: res.ext, quality: res.quality } : null
  },
  lyric: (track) => getLyric(track.id),
  async playlist(id, account) {
    const pl = await getPlaylist(id, { cookie: account?.cookie, uin: account?.uin })
    return { name: pl.name, tracks: pl.tracks }
  },
  async userPlaylists(uin, account) {
    return getUserPlaylists(uin, account?.cookie)
  },
  async profile(account) {
    const p = await getProfile(account.cookie, account.uin)
    return { nickname: p.nickname, avatar: p.avatar, vip: p.vip, setCookie: p.setCookie }
  },
}

export const neteaseProvider: Provider = {
  id: 'netease',
  name: '网易云音乐',
  color: '#c20c0c',
  search: (keyword, page) => ne.searchSongs(keyword, page),
  searchAlbums: (keyword) => ne.searchAlbums(keyword),
  searchArtists: (keyword) => ne.searchArtists(keyword),
  album: (id) => ne.getAlbumDetail(id),
  artist: (id) => ne.getArtistDetail(id),
  async getUrl(track, quality, account) {
    const res = await ne.getUrl(track.id, quality, account?.cookie)
    return res ? { url: res.url, ext: res.ext, quality: res.quality } : null
  },
  lyric: (track) => ne.getLyric(track.id),
  async playlist(id, account) {
    const pl = await ne.getPlaylist(id, account?.cookie)
    return { name: pl.name, tracks: pl.tracks }
  },
  async userPlaylists(uin, account) {
    if (!account?.cookie) return []
    return ne.getUserPlaylists(uin, account.cookie)
  },
  async profile(account) {
    const p = await ne.getProfile(account.cookie)
    return { nickname: p.nickname, avatar: p.avatar, vip: p.vip }
  },
}

export const qishuiProvider: Provider = {
  async repair(track) {
    return qs.resolveCandidates(track.title, track.artists)
  },
  id: 'qishui',
  name: '汽水音乐',
  color: '#fe2c55',
  search: (keyword, page) => qs.searchSongs(keyword, page),
  searchAlbums: (keyword) => qs.searchAlbums(keyword),
  searchArtists: (keyword) => qs.searchArtists(keyword),
  album: (id) => qs.getAlbumDetail(id),
  artist: (id) => qs.getArtistDetail(id),
  async getUrl(track, quality) {
    const res = await qs.getUrl(track.id, quality)
    return res ? { url: res.url, ext: res.ext, quality: res.quality } : null
  },
  lyric: (track) => qs.getLyric(track.id),
  async playlist(id) {
    const pl = await qs.getPlaylist(id)
    return { name: pl.name, tracks: pl.tracks }
  },
  async userPlaylists() {
    return qs.getUserPlaylists('')
  },
  async profile() {
    const user = await qs.getProfile()
    return { nickname: user.nickname || '汽水账号', avatar: '', vip: user.isVip ? 1 : 0 }
  },
}

export const appleProvider: Provider = {
  id: 'apple',
  name: 'Apple Music',
  color: '#fa243c',
  search: (keyword, page) => ap.searchSongs(keyword, page),
  searchAlbums: (keyword) => ap.searchAlbums(keyword),
  searchArtists: (keyword) => ap.searchArtists(keyword),
  album: (id) => (id.startsWith('pl.') ? ap.getPlaylistDetail(id) : ap.getAlbumDetail(id)),
  artist: (id) => ap.getArtistDetail(id),
  async getUrl(track, quality) {
    return ap.getUrl(track.id, quality)
  },
  async lyric() {
    return null
  },
  async playlist(id) {
    return ap.getPlaylist(id)
  },
  async userPlaylists() {
    return []
  },
  async profile() {
    return { nickname: 'Apple Music', avatar: '', vip: 1 }
  },
}

export const providers: Record<string, Provider> = {
  qq: qqProvider,
  netease: neteaseProvider,
  qishui: qishuiProvider,
  apple: appleProvider,
}

export function getProvider(id: string): Provider {
  const p = providers[id]
  if (!p) throw new Error(`未知平台：${id}`)
  return p
}

export { getUinFromCookie }
