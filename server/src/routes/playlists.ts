import type { FastifyInstance } from 'fastify'
import { getAccount } from '../db.js'
import { decrypt } from '../crypto.js'
import { getProvider } from '../providers/registry.js'
import { getSettings } from '../settings.js'
import { annotateBlocked } from '../download/filter.js'
import { withCoverSize } from '../util/covers.js'
import { getDefaultAccount } from '../db.js'

export function registerPlaylistRoutes(app: FastifyInstance) {
  app.get('/api/accounts/:id/playlists', async (req, reply) => {
    const id = Number((req.params as any).id)
    const account = getAccount(id)
    if (!account) return reply.code(404).send({ error: '账号不存在' })
    const cookie = decrypt(account.cookie_enc)
    const lists = await getProvider(account.provider).userPlaylists(account.uid, { cookie, uin: account.uid })
    return {
      playlists: lists
        .filter((p) => p.id)
        .map((p) => ({
          ...p,
          cover: /^https?:/.test(p.cover) ? p.cover : '',
        })),
    }
  })

  app.post('/api/playlists/resolve', async (req, reply) => {
    const body = (req.body || {}) as { url?: string; id?: string; provider?: string; accountId?: number }
    const input = String(body.url || body.id || '').trim()
    if (!input) return reply.code(400).send({ error: '请输入歌单链接或 ID' })
    let provider = body.provider
    let playlistId = ''
    const urlMatch = input.match(/(?:playlist|album)\/([A-Za-z0-9]+)/i)
    const idParam = input.match(/[?&](?:id|disstid)=([A-Za-z0-9]+)/i)
    if (/y\.qq\.com|qq\.com/i.test(input)) provider = 'qq'
    else if (/music\.163\.com|163cn\.tv/i.test(input)) provider = 'netease'
    else if (/qishui|douyin/i.test(input)) provider = 'qishui'
    if (urlMatch) playlistId = urlMatch[1]
    else if (idParam) playlistId = idParam[1]
    else if (/^[A-Za-z0-9]+$/.test(input)) playlistId = input
    if (!playlistId) return reply.code(400).send({ error: '无法识别歌单 ID，请检查链接' })
    if (!provider) {
      const account = body.accountId ? getAccount(body.accountId) : undefined
      provider = account?.provider || 'qq'
    }
    if (!['qq', 'netease', 'qishui'].includes(provider)) return reply.code(400).send({ error: '不支持的平台' })
    const account =
      (body.accountId ? getAccount(body.accountId) : undefined) ||
      getDefaultAccount(provider) ||
      undefined
    if (!account || account.provider !== provider) {
      return reply.code(400).send({ error: '该平台还没有绑定账号' })
    }
    try {
      const cookie = decrypt(account.cookie_enc)
      const playlist = await getProvider(provider).playlist(playlistId, { cookie, uin: account.uid })
      const settings = getSettings()
      return {
        playlist: {
          id: playlistId,
          ...playlist,
          tracks: annotateBlocked(withCoverSize(playlist.tracks, settings.coverSize), settings.blockWords),
        },
      }
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : '读取歌单失败' })
    }
  })

  app.get('/api/playlists/:id', async (req, reply) => {
    const disstid = String((req.params as any).id)
    const accountId = Number((req.query as any).accountId) || getSettings().downloadAccountId
    const account = accountId ? getAccount(accountId) : undefined
    if (!account) return reply.code(400).send({ error: '请先绑定账号' })
    const settings = getSettings()
    const cookie = decrypt(account.cookie_enc)
    const playlist = await getProvider(account.provider).playlist(disstid, { cookie, uin: account.uid })
    return {
      playlist: {
        ...playlist,
        tracks: annotateBlocked(withCoverSize(playlist.tracks, settings.coverSize), settings.blockWords),
      },
    }
  })
}
