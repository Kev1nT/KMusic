import type { FastifyInstance } from 'fastify'
import { getLogs } from '../logger.js'

export function registerLogRoutes(app: FastifyInstance) {
  app.get('/api/logs', async (req) => {
    const q = req.query as { after?: string; limit?: string }
    const after = Number(q?.after || 0) || 0
    const limit = Math.min(1000, Math.max(50, Number(q?.limit || 500) || 500))
    return getLogs(after, limit)
  })
}
