import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  allowedRoots,
  convertLyrics,
  convertNames,
  copyEntries,
  deleteEntries,
  fixMissing,
  listDirectory,
  mkdirEntry,
  moveEntries,
  readTags,
  renameEntry,
  scanMissing,
  writeTags,
} from '../files.js'
import { organizeFiles } from '../organize.js'

const modeSchema = z.enum(['trash', 'permanent']).default('trash')
const pathList = z.array(z.string().min(1)).min(1)

export function registerFileRoutes(app: FastifyInstance) {
  app.get('/api/files/roots', async () => {
    const all = allowedRoots().sort((a, b) => a.length - b.length)
    const top: string[] = []
    for (const root of all) {
      if (!top.some((parent) => root === parent || root.startsWith(parent + '/'))) top.push(root)
    }
    return { roots: top.map((root) => ({ path: root, name: root === '/' ? '根目录' : root })) }
  })

  app.get('/api/files/list', async (req, reply) => {
    const input = String((req.query as any).path || '')
    if (!input) return reply.code(400).send({ error: '缺少 path' })
    try {
      return await listDirectory(input)
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : '读取目录失败' })
    }
  })

  app.post('/api/files/rename', async (req, reply) => {
    const parsed = z.object({ path: z.string().min(1), newName: z.string().min(1) }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message })
    try {
      return await renameEntry(parsed.data.path, parsed.data.newName)
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : '重命名失败' })
    }
  })

  app.post('/api/files/copy', async (req, reply) => {
    const parsed = z.object({ paths: pathList, dest: z.string().min(1) }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message })
    try {
      return await copyEntries(parsed.data.paths, parsed.data.dest)
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : '复制失败' })
    }
  })

  app.post('/api/files/move', async (req, reply) => {
    const parsed = z.object({ paths: pathList, dest: z.string().min(1) }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message })
    try {
      return await moveEntries(parsed.data.paths, parsed.data.dest)
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : '移动失败' })
    }
  })

  app.post('/api/files/delete', async (req, reply) => {
    const parsed = z.object({ paths: pathList, mode: modeSchema }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message })
    return deleteEntries(parsed.data.paths, parsed.data.mode)
  })

  app.post('/api/files/mkdir', async (req, reply) => {
    const parsed = z.object({ parent: z.string().min(1), name: z.string().min(1) }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message })
    try {
      return await mkdirEntry(parsed.data.parent, parsed.data.name)
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : '新建目录失败' })
    }
  })

  app.get('/api/files/tags', async (req, reply) => {
    const input = String((req.query as any).path || '')
    if (!input) return reply.code(400).send({ error: '缺少 path' })
    try {
      return await readTags(input)
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : '读取标签失败' })
    }
  })

  app.post('/api/files/tags', async (req, reply) => {
    const parsed = z
      .object({
        path: z.string().min(1),
        tags: z.record(z.string(), z.string()).default({}),
      })
      .safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message })
    try {
      return await writeTags(parsed.data.path, parsed.data.tags)
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : '写入标签失败' })
    }
  })

  app.post('/api/files/missing/scan', async (req, reply) => {
    const parsed = z
      .object({
        path: z.string().min(1),
        checks: z
          .object({ tags: z.boolean().optional(), lyric: z.boolean().optional(), cover: z.boolean().optional(), nfo: z.boolean().optional() })
          .optional(),
      })
      .safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message })
    try {
      return await scanMissing(parsed.data.path, parsed.data.checks || {})
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : '查缺失败' })
    }
  })

  app.post('/api/files/missing/fix', async (req, reply) => {
    const parsed = z
      .object({
        paths: pathList,
        checks: z
          .object({ tags: z.boolean().optional(), lyric: z.boolean().optional(), cover: z.boolean().optional(), nfo: z.boolean().optional() })
          .optional(),
      })
      .safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message })
    return fixMissing(parsed.data.paths, parsed.data.checks || {})
  })

  app.post('/api/files/organize', async (req, reply) => {
    const parsed = z
      .object({
        paths: pathList,
        root: z.string().min(1),
        template: z.string().min(1),
        dryRun: z.boolean().optional(),
      })
      .safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message })
    try {
      return await organizeFiles(parsed.data.paths, parsed.data.root, parsed.data.template, parsed.data.dryRun === true)
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : '整理失败' })
    }
  })

  app.post('/api/files/convert-names', async (req, reply) => {
    const parsed = z
      .object({ paths: pathList, direction: z.enum(['s2t', 't2s']) })
      .safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message })
    return convertNames(parsed.data.paths, parsed.data.direction)
  })

  app.post('/api/files/convert-lyrics', async (req, reply) => {
    const parsed = z
      .object({
        paths: pathList,
        direction: z.enum(['s2t', 't2s']).optional(),
        encoding: z.string().optional(),
        bom: z.boolean().optional(),
      })
      .safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message })
    return convertLyrics(parsed.data.paths, parsed.data.direction, parsed.data.encoding, parsed.data.bom === true)
  })
}
