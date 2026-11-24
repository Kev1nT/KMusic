import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const root = process.cwd()

export const config = {
  port: Number(process.env.PORT || 8080),
  host: process.env.HOST || '0.0.0.0',
  dataDir: path.resolve(process.env.DATA_DIR || path.join(root, 'data')),
  musicDir: path.resolve(process.env.MUSIC_DIR || path.join(root, 'music')),
  adminPassword: process.env.ADMIN_PASSWORD || 'admin',
  isProd: process.env.NODE_ENV === 'production',
  version: '0.1.0',
}

for (const dir of [config.dataDir, config.musicDir]) {
  fs.mkdirSync(dir, { recursive: true })
}

const secretFile = path.join(config.dataDir, 'secret.key')
let secret: string
try {
  secret = fs.readFileSync(secretFile, 'utf8').trim()
  if (secret.length < 32) throw new Error('secret too short')
} catch {
  secret = crypto.randomBytes(32).toString('base64url')
  fs.writeFileSync(secretFile, secret, { mode: 0o600 })
}

export const secrets = {
  jwt: crypto.createHash('sha256').update(`${secret}:jwt`).digest(),
  cookie: crypto.createHash('sha256').update(`${secret}:cookie`).digest(),
}
