import Fastify from 'fastify'
import { getLogs, pinoSink } from './logger.js'
import cookie from '@fastify/cookie'
import jwt from '@fastify/jwt'
import fastifyStatic from '@fastify/static'
import fs from 'node:fs'
import path from 'node:path'
import { config, secrets } from './config.js'
import { HttpError } from './util/http.js'
import { registerAuthRoutes } from './routes/auth.js'
import { registerAccountRoutes } from './routes/accounts.js'
import { registerSearchRoutes } from './routes/search.js'
import { registerDiscoverRoutes } from './routes/discover.js'
import { registerPlaylistRoutes } from './routes/playlists.js'
import { registerSubscriptionRoutes } from './routes/subscriptions.js'
import { registerTaskRoutes } from './routes/tasks.js'
import { registerSettingsRoutes } from './routes/settings.js'
import { registerStatsRoutes } from './routes/stats.js'
import { registerDashboardRoutes } from './routes/dashboard.js'
import { registerLibraryRoutes } from './routes/library.js'
import { registerFileRoutes } from './routes/files.js'
import { registerAppleRoutes } from './routes/apple.js'
import { registerLogRoutes } from './routes/logs.js'
import { resumePending } from './download/pipeline.js'
import { startScheduler } from './scheduler.js'

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL || 'info', stream: pinoSink() },
  // 不打印每个 HTTP 请求（太吵），业务日志 + 错误才是重点
  disableRequestLogging: true,
})

await app.register(cookie)
await app.register(jwt, {
  secret: secrets.jwt.toString('base64url'),
  sign: { expiresIn: '7d' },
})

const publicPaths = new Set(['/api/auth/login', '/api/health'])

app.addHook('onRequest', async (req, reply) => {
  if (!req.url.startsWith('/api/')) return
  const pathname = req.url.split('?')[0]
  if (publicPaths.has(pathname)) return
  // 音频流走 <audio> 标签，不能带 Authorization 头 → 允许用 ?t= 传 JWT
  if (pathname === '/api/apple/stream') {
    const t = new URL(req.url, 'http://localhost').searchParams.get('t')
    if (t) {
      try {
        app.jwt.verify(t)
        return
      } catch {
        /* 落到下面的统一 401 */
      }
    }
  }
  try {
    await req.jwtVerify()
  } catch {
    return reply.code(401).send({ error: '未登录或登录已过期' })
  }
})

app.setErrorHandler((err: any, _req, reply) => {
  if (err instanceof HttpError) {
    return reply.code(err.status).send({ error: err.message })
  }
  const status = (err as any).statusCode && (err as any).statusCode < 500 ? (err as any).statusCode : 500
  if (status >= 500) app.log.error(err)
  return reply.code(status).send({ error: err.message || '服务器内部错误' })
})

app.get('/api/health', async () => ({ ok: true, version: config.version, time: new Date().toISOString() }))

registerAuthRoutes(app)
registerAccountRoutes(app)
registerSearchRoutes(app)
registerDiscoverRoutes(app)
registerPlaylistRoutes(app)
registerSubscriptionRoutes(app)
registerTaskRoutes(app)
registerSettingsRoutes(app)
registerAppleRoutes(app)
registerLogRoutes(app)
registerStatsRoutes(app)
registerDashboardRoutes(app)
registerLibraryRoutes(app)
registerFileRoutes(app)

const webDist = path.resolve('web/dist')
if (fs.existsSync(webDist)) {
  await app.register(fastifyStatic, {
    root: webDist,
    prefix: '/',
    cacheControl: false,
    setHeaders: (res, filePath) => {
      // index.html 永不缓存，避免刷新后仍拿到旧的前端引用；带 hash 的 assets 可长缓存
      if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-store, must-revalidate')
      else res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    },
  })
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: '接口不存在' })
    reply.header('Cache-Control', 'no-store, must-revalidate')
    return reply.sendFile('index.html')
  })
}

resumePending()
startScheduler()

await app.listen({ port: config.port, host: config.host })
app.log.info(`KMusic 已启动：http://localhost:${config.port}`)
