import crypto from 'node:crypto'
import { UA } from '../../util/http.js'
import { getProfile } from './api.js'
import { upsertAccount } from '../../accountStore.js'

const APPID = 'wx48db31d50e334801'
const REDIRECT = 'https://y.qq.com/portal/wx_redirect.html?login_type=2&surl=https%3A%2F%2Fy.qq.com%2F'

export interface WxQrPublic {
  id: string
  status: 'waiting' | 'scanned' | 'confirmed' | 'ok' | 'expired' | 'error'
  qr: string
  message?: string
  accountId?: number
  nickname?: string
  avatar?: string
}

interface WxSession extends WxQrPublic {
  uuid: string
  createdAt: number
  polling: boolean
}

const sessions = new Map<string, WxSession>()

function toPublic(s: WxSession): WxQrPublic {
  return {
    id: s.id,
    status: s.status,
    qr: s.qr,
    message: s.message,
    accountId: s.accountId,
    nickname: s.nickname,
    avatar: s.avatar,
  }
}

export async function createWxSession(): Promise<WxQrPublic> {
  const url =
    `https://open.weixin.qq.com/connect/qrconnect?appid=${APPID}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT)}&response_type=code&scope=snsapi_login&state=STATE` +
    `&href=${encodeURIComponent('https://y.qq.com/mediastyle/music_v17/src/css/popup_wechat.css#wechat_redirect')}`
  const page = await fetch(url, { headers: { 'User-Agent': UA } })
  const html = await page.text()
  const match = html.match(/uuid=([A-Za-z0-9]{10,})/)
  if (!match) throw new Error('未获取到微信登录 uuid')
  const uuid = match[1]
  const img = await fetch(`https://open.weixin.qq.com/connect/qrcode/${uuid}`, {
    headers: { 'User-Agent': UA, Referer: 'https://open.weixin.qq.com/' },
  })
  const buf = Buffer.from(await img.arrayBuffer())
  if (!buf.length) throw new Error('获取微信二维码失败')
  const session: WxSession = {
    id: crypto.randomUUID(),
    status: 'waiting',
    qr: `data:image/jpeg;base64,${buf.toString('base64')}`,
    uuid,
    createdAt: Date.now(),
    polling: false,
  }
  sessions.set(session.id, session)
  return toPublic(session)
}

async function exchangeCode(code: string) {
  const body = {
    comm: { tmeAppID: 'qqmusic', tmeLoginType: '1' },
    req: { module: 'music.login.LoginServer', method: 'Login', param: { strAppid: APPID, code } },
  }
  const res = await fetch('https://u.y.qq.com/cgi-bin/musicu.fcg', {
    method: 'POST',
    headers: { 'User-Agent': UA, Referer: 'https://y.qq.com/', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const raw = await res.text()
  const data: any = JSON.parse(raw)
  const d = data?.req?.data || data?.req_0?.data || {}
  const key = d.musickey || d.musicKey || d.key
  const rawId = raw.match(/"musicid"\s*:\s*"?([0-9]{10,})"?/i)?.[1]
  const musicId = rawId || String(d.musicid || d.musicId || d.uin || '').replace(/\D/g, '')
  if (!key || !musicId) throw new Error(`微信登录交换失败：${JSON.stringify(data).slice(0, 200)}`)
  return { key, musicId }
}

export async function pollWxSession(id: string): Promise<WxQrPublic> {
  const s = sessions.get(id)
  if (!s) throw new Error('二维码会话不存在')
  if (['ok', 'expired', 'error'].includes(s.status)) return toPublic(s)
  if (s.polling) return toPublic(s)
  s.polling = true
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 25_000)
    let text = ''
    try {
      const res = await fetch(
        `https://lp.open.weixin.qq.com/connect/l/qrconnect?uuid=${s.uuid}&_=${Date.now()}`,
        {
          headers: { 'User-Agent': UA, Referer: 'https://open.weixin.qq.com/' },
          signal: controller.signal,
        },
      )
      text = await res.text()
    } finally {
      clearTimeout(timer)
    }
    const code = Number(text.match(/wx_errcode=(\d+)/)?.[1] || 0)
    if (code === 408) {
      s.status = 'waiting'
      s.message = '等待扫码'
    } else if (code === 404) {
      s.status = 'scanned'
      s.message = '已扫码，请在手机上确认'
    } else if (code === 405) {
      const wxCode = text.match(/wx_code='([^']*)'/)?.[1] || ''
      if (!wxCode) throw new Error('未获取到微信授权 code')
      s.status = 'confirmed'
      const { key, musicId } = await exchangeCode(wxCode)
      const cookie = `uin=o${musicId}; qm_keyst=${key}; qqmusic_key=${key}; login_type=2`
      let profile = { nickname: `QQ ${musicId}`, avatar: '', vip: 0 }
      try {
        const p = await getProfile(cookie, musicId)
        profile = { nickname: p.nickname, avatar: p.avatar, vip: p.vip }
      } catch {
        /* 允许降级 */
      }
      const accountId = upsertAccount('qq', musicId, profile, cookie)
      s.status = 'ok'
      s.accountId = accountId
      s.nickname = profile.nickname
      s.avatar = profile.avatar
      s.qr = ''
    } else {
      s.status = 'waiting'
      s.message = '等待扫码'
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      s.status = 'waiting'
      s.message = '等待扫码'
    } else {
      s.status = 'error'
      s.message = err instanceof Error ? err.message : '微信登录失败'
    }
  } finally {
    s.polling = false
  }
  return toPublic(s)
}
