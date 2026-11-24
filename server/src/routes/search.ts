import type { FastifyInstance } from 'fastify'
import { getProvider } from '../providers/registry.js'
import { getSettings } from '../settings.js'
import { annotateBlocked } from '../download/filter.js'
import { withAvatarSize, withCoverSize } from '../util/covers.js'

export function registerSearchRoutes(app: FastifyInstance) {
  app.get('/api/search/all', async (req) => {
    const query = req.query as { q?: string; sources?: string }
    const keyword = (query.q || '').trim()
    if (!keyword) return { tracks: [], errors: [] }
    const sources = (query.sources || 'qq,netease')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => ['qq', 'netease', 'qishui', 'apple'].includes(s))
    const settings = getSettings()
    const errors: { provider: string; message: string }[] = []
    const groups = await Promise.all(
      sources.map(async (id) => {
        try {
          const tracks = await getProvider(id).search(keyword, 1)
          return annotateBlocked(withCoverSize(tracks, settings.coverSize), settings.blockWords)
        } catch (err) {
          errors.push({ provider: id, message: err instanceof Error ? err.message : String(err) })
          return []
        }
      }),
    )
    const merged: any[] = []
    const max = Math.max(0, ...groups.map((g) => g.length))
    for (let i = 0; i < max; i++) {
      for (const group of groups) if (group[i]) merged.push(group[i])
    }
    return { tracks: merged, errors, keyword }
  })

  app.get('/api/search', async (req, reply) => {
    const query = req.query as { q?: string; page?: string; type?: string; provider?: string }
    const keyword = (query.q || '').trim()
    if (!keyword) return reply.code(400).send({ error: '请输入搜索关键词' })
    const type = query.type || 'song'
    const page = Math.max(1, Number(query.page) || 1)
    const settings = getSettings()
    const provider = getProvider(query.provider || 'qq')

    if (type === 'album') {
      const albums = await provider.searchAlbums(keyword)
      return { type, keyword, albums: withCoverSize(albums, settings.coverSize) }
    }
    if (type === 'artist') {
      const artists = await provider.searchArtists(keyword)
      return { type, keyword, artists: withAvatarSize(artists, 300) }
    }

    const tracks = await provider.search(keyword, page)
    return {
      type: 'song',
      keyword,
      page,
      tracks: annotateBlocked(withCoverSize(tracks, settings.coverSize), settings.blockWords),
    }
  })
}
