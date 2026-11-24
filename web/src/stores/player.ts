import { defineStore } from 'pinia'
import { api, getToken, type Track } from '@/lib/api'
import { parseAppleTTML } from '@/lib/ttml'

let audio: HTMLAudioElement | null = null

export const usePlayerStore = defineStore('player', {
  state: () => ({
    track: null as Track | null,
    queue: [] as Track[],
    index: -1,
    playing: false,
    currentMs: 0,
    durationMs: 0,
    preparing: false,
    prepPct: 0,
    error: '',
    lyricLines: [] as any[],
    expanded: false,
    showLyrics: false,
  }),
  getters: {
    hasPrev: (s) => s.index > 0,
    hasNext: (s) => s.index >= 0 && s.index < s.queue.length - 1,
  },
  actions: {
    ensureAudio(): HTMLAudioElement {
      if (audio) return audio
      const a = new Audio()
      audio = a
      a.preload = 'auto'
      let raf = 0
      const tick = () => {
        if (!a.paused) {
          this.currentMs = a.currentTime * 1000
          raf = requestAnimationFrame(tick)
        }
      }
      // 用 requestAnimationFrame 平滑推进时间（timeupdate 只有 ~4Hz，amll 弹簧动画会顿）
      a.addEventListener('timeupdate', () => {
        if (a.paused) this.currentMs = a.currentTime * 1000
      })
      a.addEventListener('durationchange', () => {
        this.durationMs = (a.duration || 0) * 1000
      })
      a.addEventListener('play', () => {
        this.playing = true
        cancelAnimationFrame(raf)
        raf = requestAnimationFrame(tick)
      })
      a.addEventListener('pause', () => {
        this.playing = false
        cancelAnimationFrame(raf)
      })
      a.addEventListener('ended', () => {
        this.playing = false
        if (this.hasNext) void this.next()
      })
      return a
    },
    async play(track: Track, list?: Track[]) {
      if (list && list.length) {
        this.queue = list.slice()
        this.index = this.queue.findIndex((t) => t.id === track.id)
        if (this.index < 0) {
          this.queue.unshift(track)
          this.index = 0
        }
      } else if (!this.queue.some((t) => t.id === track.id)) {
        this.queue = [track]
        this.index = 0
      } else {
        this.index = this.queue.findIndex((t) => t.id === track.id)
      }
      this.track = track
      this.lyricLines = []
      this.currentMs = 0
      this.durationMs = track.durationMs || 0
      this.error = ''
      if (!track.sourceUrl) {
        this.error = '该曲目缺少播放链接'
        return
      }
      this.preparing = true
      this.prepPct = 0
      try {
        let st = await api<any>('/apple/prepare', {
          method: 'POST',
          body: JSON.stringify({ trackId: track.id, sourceUrl: track.sourceUrl }),
        })
        while (st.status === 'preparing') {
          this.prepPct = st.pct || 0
          await new Promise((r) => setTimeout(r, 2000))
          st = await api<any>(`/apple/prepare/status?trackId=${encodeURIComponent(track.id)}`)
        }
        if (st.status !== 'ready') throw new Error(st.error || '准备播放失败')
        const a = this.ensureAudio()
        a.src = `/api/apple/stream?trackId=${encodeURIComponent(track.id)}&t=${encodeURIComponent(getToken())}`
        await a.play()
        void this.loadLyrics(track.id)
      } catch (e) {
        this.error = e instanceof Error ? e.message : String(e)
      } finally {
        this.preparing = false
      }
    },
    async next() {
      if (!this.hasNext) return
      const t = this.queue[this.index + 1]
      if (t) await this.play(t)
    },
    async prev() {
      if (!this.hasPrev) return
      const t = this.queue[this.index - 1]
      if (t) await this.play(t)
    },
    async loadLyrics(trackId: string) {
      try {
        const r = await api<{ ttml: string }>(`/apple/lyrics?trackId=${encodeURIComponent(trackId)}`)
        // 用已验证的本地解析器解析 TTML，再映射成 amll LyricLine 结构
        this.lyricLines = parseAppleTTML(r.ttml || '').map((l) => ({
          startTime: l.startMs,
          endTime: l.endMs,
          words: l.words.map((w) => ({ text: w.text, startTime: w.startMs, endTime: w.endMs })),
          translatedLyric: '',
          romanLyric: '',
          isBG: false,
          isDuet: false,
        })) as any[]
      } catch {
        this.lyricLines = []
      }
    },
    toggle() {
      const a = this.ensureAudio()
      if (a.paused) void a.play()
      else a.pause()
    },
    seek(ms: number) {
      const a = this.ensureAudio()
      a.currentTime = Math.max(0, ms / 1000)
      this.currentMs = ms
    },
    stop() {
      if (audio) {
        audio.pause()
        audio.removeAttribute('src')
      }
      this.track = null
      this.playing = false
      this.lyricLines = []
      this.queue = []
      this.index = -1
    },
  },
})
