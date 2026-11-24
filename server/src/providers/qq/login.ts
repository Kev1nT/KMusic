import crypto from 'node:crypto'
import { db, now } from '../../db.js'
import { encrypt } from '../../crypto.js'
import { UA } from '../../util/http.js'
import { getProfile } from './api.js'

const APPID = '716027609'
const DAID = '383'
const PT_3RD_AID = '100497308'
const U1 = 'https://graph.qq.com/oauth2.0/login_jump'

export interface QrPublic {
  id: string
  status: 'waiting' | 'scanned' | 'confirmed' | 'expired' | 'ok' | 'error'
  qr: string
  message?: string
  accountId?: number
  nickname?: string
  avatar?: string
  vip?: number
}

interface QrSession extends QrPublic {
  qrsig: string
  ptqrtoken: number
  jar: Map<string, string>
  createdAt: number
}

const sessions = new Map<string, QrSession>()

function hash33(input: string, seed = 0): number {
  let e = seed
  for (let i = 0; i < input.length; i++) e += (e << 5) + input.charCodeAt(i)
  return 2147483647 & e
}

function cookieHeader(jar: Map<string, string>): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
}

function storeCookies(jar: Map<string, string>, res: Response) {
  const list = typeof (res.headers as any).getSetCookie === 'function' ? (res.headers as any).getSetCookie() : []
  for (const raw of list as string[]) {
    const pair = raw.split(';')[0]
    const idx = pair.indexOf('=')
    if (idx > 0) jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim())
  }
}

function gtk(jar: Map<string, string>): number {
  const key = jar.get('qqmusic_key') || jar.get('p_skey') || jar.get('skey') || ''
  return hash33(key, 5381)
}

function toPublic(s: QrSession): QrPublic {
  return {
    id: s.id,
    status: s.status,
    qr: s.qr,
    message: s.message,
    accountId: s.accountId,
    nickname: s.nickname,
    avatar: s.avatar,
    vip: s.vip,
  }
}

export async function createQrSession(): Promise<QrPublic> {
  const t = Math.random().toFixed(17)
  const url =
    `https://xui.ptlogin2.qq.com/ssl/ptqrshow?appid=${APPID}&e=2&l=M&s=3&d=72&v=4&t=${t}` +
    `&daid=${DAID}&pt_3rd_aid=${PT_3RD_AID}&u1=${encodeURIComponent(U1)}`
  const res = await fetch(url, { headers: { 'User-Agent': UA, Referer: 'https://xui.ptlogin2.qq.com/' } })
  const buf = Buffer.from(await res.arrayBuffer())
  if (!res.ok || buf.length < 100) throw new Error('获取二维码失败')
  const jar = new Map<string, string>()
  storeCookies(jar, res)
  const qrsig = jar.get('qrsig') || ''
  if (!qrsig) throw new Error('未获取到 qrsig')
  const session: QrSession = {
    id: crypto.randomUUID(),
    status: 'waiting',
    qr: `data:image/png;base64,${buf.toString('base64')}`,
    qrsig,
    ptqrtoken: hash33(qrsig),
    jar,
    createdAt: Date.now(),
  }
  sessions.set(session.id, session)
  return toPublic(session)
}

async function followForCode(start: string, jar: Map<string, string>): Promise<string> {
  let url = start
  for (let i = 0; i < 12; i++) {
    const res = await fetch(url, {
      redirect: 'manual',
      headers: { 'User-Agent': UA, Cookie: cookieHeader(jar), Referer: 'https://y.qq.com/' },
    })
    storeCookies(jar, res)
    const loc = res.headers.get('location')
    if (!loc) return url
    const next = new URL(loc, url).toString()
    if (next.includes('code=')) return next
    url = next
  }
  return url
}

async function exchangeCode(code: string, jar: Map<string, string>) {
  const body = {
    comm: { g_tk: gtk(jar), platform: 'yqq', ct: 24, cv: 0 },
    req: { module: 'QQConnectLogin.LoginServer', method: 'QQLogin', param: { code } },
  }
  const res = await fetch('https://u.y.qq.com/cgi-bin/musicu.fcg', {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      Referer: 'https://y.qq.com/',
      'Content-Type': 'application/json',
      Cookie: cookieHeader(jar),
    },
    body: JSON.stringify(body),
  })
  const raw = await res.text()
  const data: any = JSON.parse(raw)
  const d = data?.req?.data || data?.req_0?.data || {}
  const key = d.musickey || d.musicKey || d.key || ''
  // musicid 是 19 位整数，直接 JSON.parse 会丢精度；从原始 JSON 文本提取精确值
  const rawId = raw.match(/"musicid"\s*:\s*"?([0-9]{10,})"?/i)?.[1]
  const musicId = rawId || String(d.musicid || d.musicId || d.uin || '').replace(/\D/g, '')
  if (!key || !musicId) {
    throw new Error(`QQ 登录交换失败：${JSON.stringify(data).slice(0, 200)}`)
  }
  return { key, musicId }
}

function upsertAccount(cookie: string, musicId: string, profile: { nickname: string; avatar: string; vip: number }) {
  const ts = now()
  db.prepare(
    `INSERT INTO accounts (provider, uid, nickname, alias, avatar, vip, cookie_enc, is_default, status, last_check_at, created_at, updated_at)
     VALUES ('qq', ?, ?, '', ?, ?, ?, 0, 'ok', ?, ?, ?)
     ON CONFLICT(provider, uid) DO UPDATE SET
       nickname = excluded.nickname,
       avatar = excluded.avatar,
       vip = excluded.vip,
       cookie_enc = excluded.cookie_enc,
       status = 'ok',
       last_check_at = excluded.last_check_at,
       updated_at = excluded.updated_at`,
  ).run(musicId, profile.nickname, profile.avatar, profile.vip, encrypt(cookie), ts, ts, ts)

  const row = db.prepare('SELECT * FROM accounts WHERE provider = ? AND uid = ?').get('qq', musicId) as any
  const hasDefault = (db.prepare('SELECT COUNT(*) c FROM accounts WHERE provider = ? AND is_default = 1').get('qq') as any).c
  if (!hasDefault) {
    db.prepare('UPDATE accounts SET is_default = 1 WHERE id = ?').run(row.id)
    db.prepare('SELECT value FROM settings WHERE key = ?').get('settings')
    const current = db.prepare('SELECT value FROM settings WHERE key = ?').get('settings') as any
    const parsed = current?.value ? JSON.parse(current.value) : {}
    parsed.downloadAccountId = row.id
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
      'settings',
      JSON.stringify(parsed),
    )
  }
  return row.id as number
}

export async function pollQrSession(id: string): Promise<QrPublic> {
  const s = sessions.get(id)
  if (!s) throw new Error('二维码会话不存在')
  if (s.status === 'ok' || s.status === 'expired' || s.status === 'error') return toPublic(s)

  const ts = Date.now()
  const url =
    `https://xui.ptlogin2.qq.com/ssl/ptqrlogin?u1=${encodeURIComponent(U1)}` +
    `&ptqrtoken=${s.ptqrtoken}&ptredirect=0&h=1&t=1&g=1&from_ui=1&ptlang=2052` +
    `&action=0-0-${ts}&js_ver=26100915&js_type=1&login_sig=&pt_uistyle=40` +
    `&aid=${APPID}&daid=${DAID}&pt_3rd_aid=${PT_3RD_AID}&pt_js_version=3ea7b82c`
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Cookie: cookieHeader(s.jar), Referer: 'https://xui.ptlogin2.qq.com/' },
  })
  storeCookies(s.jar, res)
  const text = await res.text()
  const m = text.match(/ptuiCB\('(\d+)','\d+','([^']*)','\d+','([^']*)'/)
  const code = m?.[1]
  const redirect = m?.[2] || ''
  const message = m?.[3] || ''

  if (code === '66') {
    s.status = 'waiting'
    s.message = message
    return toPublic(s)
  }
  if (code === '67') {
    s.status = 'scanned'
    s.message = message
    return toPublic(s)
  }
  if (code === '65') {
    s.status = 'expired'
    s.message = '二维码已失效，请重新获取'
    return toPublic(s)
  }
  if (code !== '0') {
    s.status = 'error'
    s.message = message || text.slice(0, 80)
    return toPublic(s)
  }

  s.status = 'confirmed'
  s.message = message
  try {
    const finalUrl = await followForCode(redirect, s.jar)
    const codeParam = new URL(finalUrl).searchParams.get('code')
    if (!codeParam) throw new Error('未获取到授权 code')
    const { key, musicId } = await exchangeCode(codeParam, s.jar)
    const cookie = `uin=o${musicId}; qm_keyst=${key}; qqmusic_key=${key}`
    let profile = { nickname: `QQ ${musicId}`, avatar: '', vip: 0 }
    try {
      const p = await getProfile(cookie, musicId)
      profile = { nickname: p.nickname, avatar: p.avatar, vip: p.vip }
    } catch {
      /* 允许降级 */
    }
    const accountId = upsertAccount(cookie, musicId, profile)
    s.status = 'ok'
    s.accountId = accountId
    s.nickname = profile.nickname
    s.avatar = profile.avatar
    s.vip = profile.vip
    s.qr = ''
  } catch (err) {
    s.status = 'error'
    s.message = err instanceof Error ? err.message : '登录失败'
  }
  return toPublic(s)
}
