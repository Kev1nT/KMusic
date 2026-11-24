import crypto from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { config } from '../config.js'

const attempts = new Map<string, { count: number; until: number }>()

function samePassword(input: string, expected: string) {
  const a = crypto.createHash('sha256').update(input).digest()
  const b = crypto.createHash('sha256').update(expected).digest()
  return crypto.timingSafeEqual(a, b)
}

export function registerAuthRoutes(app: FastifyInstance) {
  app.post('/api/auth/login', async (req, reply) => {
    const ip = req.ip
    const record = attempts.get(ip)
    if (record && record.until > Date.now()) {
      const wait = Math.ceil((record.until - Date.now()) / 1000)
      return reply.code(429).send({ error: `尝试次数过多，请 ${wait} 秒后再试` })
    }
    const password = String((req.body as any)?.password || '')
    if (!samePassword(password, config.adminPassword)) {
      const next = { count: (record?.count || 0) + 1, until: 0 }
      if (next.count >= 5) {
        next.until = Date.now() + 5 * 60_000
        next.count = 0
      }
      attempts.set(ip, next)
      return reply.code(401).send({ error: '密码错误' })
    }
    attempts.delete(ip)
    const token = app.jwt.sign({ sub: 'admin' })
    return { token }
  })

  app.get('/api/auth/me', async () => ({ user: 'admin' }))
}
