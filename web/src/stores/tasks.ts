import { defineStore } from 'pinia'
import { api, type Quality, type Task, type Track } from '@/lib/api'

let timer: ReturnType<typeof setInterval> | null = null

export const useTasksStore = defineStore('tasks', {
  state: () => ({
    tasks: [] as Task[],
    totalFailed: 0,
    loading: false,
  }),
  getters: {
    active(state) {
      return state.tasks.filter((t) =>
        ['queued', 'resolving', 'downloading', 'verifying', 'tagging'].includes(t.status),
      )
    },
  },
  actions: {
    async load() {
      const data = await api<{ tasks: Task[]; totalFailed?: number }>('/tasks?limit=100')
      this.tasks = data.tasks
      this.totalFailed = data.totalFailed ?? this.tasks.filter((t) => t.status === 'failed').length
    },
    async create(track: Track, quality: Quality, force = false) {
      const data = await api<{ task?: Task; deduped?: boolean; skipped?: boolean; message?: string }>('/tasks', {
        method: 'POST',
        body: JSON.stringify({ track, quality, force }),
      })
      await this.load()
      return data
    },
    async retry(id: number) {
      await api(`/tasks/${id}/retry`, { method: 'POST' })
      await this.load()
    },
    async retryAllFailed(provider?: string) {
      const data = await api<{ count: number; remaining?: number }>('/tasks/retry-failed', {
        method: 'POST',
        body: JSON.stringify(provider ? { provider } : {}),
      })
      await this.load()
      return data
    },
    async cancel(id: number) {
      await api(`/tasks/${id}/cancel`, { method: 'POST' })
      await this.load()
    },
    async remove(id: number) {
      await api(`/tasks/${id}`, { method: 'DELETE' })
      await this.load()
    },
    async clear(status: 'failed' | 'done' | 'canceled' | 'inactive' = 'inactive') {
      const data = await api<{ removed: number }>('/tasks/clear', { method: 'POST', body: JSON.stringify({ status }) })
      await this.load()
      return data.removed
    },
    startPolling() {
      if (timer) return
      void this.load()
      timer = setInterval(() => void this.load().catch(() => {}), 2000)
    },
    stopPolling() {
      if (timer) clearInterval(timer)
      timer = null
    },
  },
})
