import type { FastifyInstance } from 'fastify'
import { getProvider } from '../providers/registry.js'
import { getSettings } from '../settings.js'
import { annotateBlocked } from '../download/filter.js'
import { withCoverSize } from '../util/covers.js'

export function registerDiscoverRoutes(app: FastifyInstance) {
  app.get('/api/albums/:mid', async (req) => {
    const mid = String((req.params as any).mid)
    const providerId = String((req.query as any).provider || 'qq')
    const settings = getSettings()
    const album = await getProvider(providerId).album(mid)
    return {
      album: {
        ...album,
        cover: withCoverSize([album], settings.coverSize)[0].cover,
        tracks: annotateBlocked(withCoverSize(album.tracks, settings.coverSize), settings.blockWords),
      },
    }
  })

  app.get('/api/artists/:mid', async (req) => {
    const mid = String((req.params as any).mid)
    const providerId = String((req.query as any).provider || 'qq')
    const settings = getSettings()
    const artist = await getProvider(providerId).artist(mid)
    return {
      artist: {
        ...artist,
        songs: annotateBlocked(withCoverSize(artist.songs, settings.coverSize), settings.blockWords),
        albums: withCoverSize(artist.albums, settings.coverSize),
      },
    }
  })
}
