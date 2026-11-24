import fs from 'node:fs'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { DEFAULT_SETTINGS, getSettings, saveSettings } from '../settings.js'

const settingsSchema = z.object({
  libraryPath: z.string().min(1).optional(),
  template: z.string().min(1).optional(),
  quality: z.enum(['hires', 'flac', '320', '128']).optional(),
  coverSize: z.number().int().refine((v) => [300, 500, 800, 1200, 1500].includes(v)).optional(),
  blockWords: z.array(z.string().max(30)).max(100).optional(),
  hideBlocked: z.boolean().optional(),
  fallback: z.boolean().optional(),
  writeNfo: z.boolean().optional(),
  writeLrc: z.boolean().optional(),
  embedCover: z.boolean().optional(),
  embedLyrics: z.boolean().optional(),
  concurrency: z.number().int().min(1).max(5).optional(),
  downloadAccountId: z.number().int().nullable().optional(),
  appleWrapperUrl: z.string().min(1).optional(),
  appleAlacDir: z.string().min(1).optional(),
  appleAtmosDir: z.string().min(1).optional(),
  appleAacDir: z.string().min(1).optional(),
  appleStorefront: z.string().length(2).optional(),
  appleCodec: z.enum(['alac', 'atmos', 'aac']).optional(),
  appleDualDownload: z.boolean().optional(),
  appleConvertFlac: z.boolean().optional(),
  appleLyricType: z.enum(['syllable', 'line']).optional(),
  appleLyricFormat: z.enum(['lrc', 'ttml']).optional(),
  appleEmbedLyric: z.boolean().optional(),
  appleSaveLrc: z.boolean().optional(),
  appleCoverSize: z.string().min(1).optional(),
})

export function registerSettingsRoutes(app: FastifyInstance) {
  app.get('/api/settings', async () => ({ settings: getSettings(), defaults: DEFAULT_SETTINGS }))

  app.put('/api/settings', async (req, reply) => {
    const parsed = settingsSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message || '参数错误' })
    }
    const patch = parsed.data
    if (patch.libraryPath) {
      try {
        fs.mkdirSync(patch.libraryPath, { recursive: true })
      } catch {
        return reply.code(400).send({ error: '下载路径不可用，请检查权限' })
      }
    }
    if (patch.template && !patch.template.includes('{title}')) {
      return reply.code(400).send({ error: '命名模板必须包含 {title}' })
    }
    return { settings: saveSettings(patch) }
  })
}
