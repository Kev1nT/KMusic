import { Writable } from 'node:stream'

export interface LogEntry {
  seq: number
  ts: number
  level: 'debug' | 'info' | 'warn' | 'error'
  scope: string
  msg: string
  detail?: string
}

const MAX = 3000
const buf: LogEntry[] = []
let seq = 0

const LEVEL_NAME: Record<number, LogEntry['level']> = {
  10: 'debug',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'error',
}

function push(level: LogEntry['level'], scope: string, msg: string, detail?: string): LogEntry {
  const entry: LogEntry = { seq: ++seq, ts: Date.now(), level, scope, msg, detail }
  buf.push(entry)
  if (buf.length > MAX) buf.splice(0, buf.length - MAX)
  return entry
}

/** 业务日志：结构化、可读，前端直接展示 */
export function logEvent(level: LogEntry['level'], scope: string, msg: string, detail?: string) {
  return push(level, scope, msg, detail)
}

export function getLogs(after = 0, limit = 800) {
  const list = after > 0 ? buf.filter((e) => e.seq > after) : buf
  return { logs: list.slice(-limit), seq }
}

/** 把 Fastify/pino 的输出也接进同一个缓冲区（容器 stdout 与页面看到的一致） */
export function pinoSink(): Writable {
  return new Writable({
    write(chunk, _enc, cb) {
      try {
        const line = String(chunk).trim()
        if (line.startsWith('{')) {
          const o = JSON.parse(line)
          const level = LEVEL_NAME[Number(o.level)] || 'info'
          const scope = String(o.scope || o.name || 'server')
          const msg = String(o.msg || o.message || '')
          const rest: Record<string, unknown> = {}
          for (const [k, v] of Object.entries(o)) {
            if (!['level', 'time', 'pid', 'hostname', 'msg', 'scope', 'name', 'v'].includes(k)) rest[k] = v
          }
          const detail = Object.keys(rest).length ? JSON.stringify(rest) : undefined
          // 过滤 HTTP 请求噪音，只保留 4xx/5xx
          if (msg === 'incoming request') {
            cb()
            return
          }
          if (msg === 'request completed') {
            const code = Number((o as any)?.res?.statusCode || 0)
            if (code < 400) {
              cb()
              return
            }
            const method = String((o as any)?.req?.method || '')
            const url = String((o as any)?.req?.url || '')
            push('warn', 'http', `${code} ${method} ${url}`)
            cb()
            return
          }
          if (msg) push(level, scope, msg, detail)
        } else if (line) {
          push('info', 'server', line)
        }
      } catch {
        /* 忽略解析失败 */
      }
      cb()
    },
  })
}
