import fs from 'node:fs'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../db.js'
import { getSettings } from '../settings.js'
import { findExistingFile, listLibraryFiles, scanLibrary } from '../library.js'
import { autoDedupe, deleteLibraryFiles, findDuplicates } from '../library-dupes.js'

export function registerLibraryRoutes(app: FastifyInstance) {
  app.post('/api/library/scan', async () => {
    const settings = getSettings()
    const accountDirs = (db.prepare("SELECT library_path FROM accounts WHERE library_path <> ''").all() as any[]).map(
      (r) => r.library_path,
    )
    return scanLibrary([settings.libraryPath, ...accountDirs])
  })

  // 批量判断曲目是否已下载（媒体库索引命中，或本应用已成功下载过）
  app.post('/api/library/check', async (req) => {
    const items = Array.isArray((req.body as any)?.items) ? (req.body as any).items : []
    // 只认「已完成且文件确实还在」的任务，失败/被删的记录不参与判断
    const doneRows = db.prepare("SELECT provider, track_id, file_path FROM tasks WHERE status = 'done'").all() as any[]
    const doneSet = new Set(
      doneRows
        .filter((r) => r.file_path && fs.existsSync(String(r.file_path)))
        .map((r) => `${r.provider}:${r.track_id}`),
    )
    const results = items.slice(0, 800).map((it: any) => {
      const key = `${it.provider}:${it.id}`
      let downloaded = doneSet.has(key)
      if (!downloaded && it.title) {
        downloaded = !!findExistingFile(String(it.title), Array.isArray(it.artists) ? it.artists : [])
      }
      return { provider: it.provider, id: String(it.id), downloaded }
    })
    return { results }
  })

  app.post('/api/library/duplicates', async () => findDuplicates())

  app.post('/api/library/delete', async (req, reply) => {
    const parsed = z
      .object({
        paths: z.array(z.string().min(1)).min(1),
        mode: z.enum(['trash', 'permanent']).default('trash'),
      })
      .safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message || '参数错误' })
    return deleteLibraryFiles(parsed.data.paths, parsed.data.mode)
  })

  app.post('/api/library/auto-dedupe', async (req, reply) => {
    const parsed = z
      .object({
        mode: z.enum(['trash', 'permanent']).default('trash'),
        dryRun: z.boolean().optional(),
      })
      .safeParse(req.body || {})
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message || '参数错误' })
    return autoDedupe(parsed.data.mode, parsed.data.dryRun === true)
  })

  app.get('/api/library/index', async () => {
    const files = listLibraryFiles()
    const roots = [...new Set(files.map((f) => f.root))]
    return { files, roots, total: files.length }
  })

  app.get('/api/library/tree', async () => {
    const files = listLibraryFiles()
    const tree = new Map<string, Map<string, any[]>>()
    for (const file of files) {
      const artist = file.artist || '未知艺术家'
      const album = file.album || '未知专辑'
      if (!tree.has(artist)) tree.set(artist, new Map())
      const albums = tree.get(artist)!
      if (!albums.has(album)) albums.set(album, [])
      albums.get(album)!.push({
        id: file.id,
        path: file.path,
        title: file.title,
        size: file.size,
        ext: file.ext,
        durationMs: file.duration_ms,
      })
    }
    return {
      total: files.length,
      artists: [...tree.entries()].map(([artist, albums]) => ({
        artist,
        albums: [...albums.entries()].map(([album, songs]) => ({ album, songs })),
      })),
    }
  })
}
