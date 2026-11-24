<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { Download, Loader2, Music2, Ban, Clock3, Play, Pause, CheckCheck } from 'lucide-vue-next'
import { QUALITY_LABEL, checkDownloaded, type Quality, type Track } from '@/lib/api'
import { formatDuration } from '@/lib/format'
import { useTasksStore } from '@/stores/tasks'
import { usePlayerStore } from '@/stores/player'
import { useToast } from '@/stores/toast'

const props = withDefaults(defineProps<{ tracks: Track[]; showAlbum?: boolean }>(), { showAlbum: true })

const tasks = useTasksStore()
const player = usePlayerStore()
const toast = useToast()
const busy = reactive<Record<string, boolean>>({})
const choices = reactive<Record<string, Quality>>({})

// 已下载判定：库里已有 或 本应用已成功下过
const downloaded = ref<Set<string>>(new Set())
const keyOf = (t: Track) => `${t.provider}:${t.id}`
function markDownloaded(t: Track) {
  const next = new Set(downloaded.value)
  next.add(keyOf(t))
  downloaded.value = next
}
function isDownloaded(t: Track): boolean {
  if (downloaded.value.has(keyOf(t))) return true
  return (tasks.tasks as any[]).some(
    (k) => k.status === 'done' && k.provider === t.provider && String(k.track_id) === String(t.id),
  )
}
async function refreshDownloaded() {
  try {
    const keys = await checkDownloaded(
      props.tracks.map((t) => ({ provider: t.provider, id: t.id, title: t.title, artists: t.artists })),
    )
    downloaded.value = new Set(keys)
  } catch {
    /* 忽略 */
  }
}
watch(() => props.tracks, refreshDownloaded, { immediate: true })

// 试听：Apple 曲目自带的 30s 未加密预览
let audioEl: HTMLAudioElement | null = null
const playing = ref<string | null>(null)
function togglePreview(track: Track) {
  if (!track.previewUrl) return
  if (!audioEl) {
    audioEl = new Audio()
    audioEl.addEventListener('ended', () => (playing.value = null))
  }
  if (playing.value === track.id) {
    audioEl.pause()
    playing.value = null
    return
  }
  audioEl.src = track.previewUrl
  audioEl.play().then(() => (playing.value = track.id)).catch(() => toast.error('试听播放失败'))
}

function qualityOf(track: Track): Quality {
  return choices[track.id] || track.qualities[0] || '128'
}

async function download(track: Track, force = false) {
  if (track.blocked) {
    toast.error(`已命中屏蔽词「${track.blockedBy}」`)
    return
  }
  busy[track.id] = true
  try {
    const res = await tasks.create(track, qualityOf(track), force)
    if (res.skipped) {
      markDownloaded(track)
      toast.push(res.message || '媒体库已存在，已跳过')
    } else {
      toast.success(res.deduped ? '这首歌已在下载队列中' : `已加入下载：${track.title}`)
    }
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '加入下载失败')
  } finally {
    busy[track.id] = false
  }
}
</script>

<template>
  <div class="space-y-1">
    <article
      v-for="track in props.tracks"
      :key="track.id"
      class="group flex items-center gap-3 rounded-2xl border border-transparent p-2.5 transition-all duration-200 hover:border-white/[0.07] hover:bg-white/[0.04] sm:gap-4 sm:p-3"
      :class="track.blocked ? 'opacity-45' : ''"
    >
      <div class="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-zinc-800 to-zinc-900 sm:h-16 sm:w-16">
        <img v-if="track.cover" :src="track.cover" :alt="track.title" loading="lazy" class="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
        <div v-else class="grid h-full w-full place-items-center text-zinc-600"><Music2 :size="20" /></div>
        <button
          v-if="track.previewUrl"
          class="absolute inset-0 grid place-items-center bg-black/45 opacity-0 transition group-hover:opacity-100"
          :class="playing === track.id ? 'opacity-100' : ''"
          :title="playing === track.id ? '暂停试听' : '试听 30s'"
          @click="togglePreview(track)"
        >
          <span class="grid h-8 w-8 place-items-center rounded-full bg-white/90 text-black shadow">
            <Pause v-if="playing === track.id" :size="15" />
            <Play v-else :size="15" class="translate-x-[1px]" />
          </span>
        </button>
      </div>

      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <h3 class="truncate text-sm font-medium text-zinc-100">{{ track.title }}</h3>
          <span
            class="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
            :class="track.provider === 'netease' ? 'bg-rose-400/10 text-rose-300' : track.provider === 'qq' ? 'bg-emerald-400/10 text-emerald-300' : track.provider === 'apple' ? 'bg-red-400/10 text-red-300' : 'bg-sky-400/10 text-sky-300'"
          >
            {{ track.provider === 'netease' ? '网易云' : track.provider === 'qq' ? 'QQ' : track.provider === 'apple' ? 'Apple' : '汽水' }}
          </span>
          <span v-if="track.qualities.includes('hires')" class="shrink-0 rounded-md bg-sky-400/10 px-1.5 py-0.5 text-[10px] font-semibold text-sky-300">Hi-Res</span>
          <span v-if="track.qualities.includes('flac')" class="shrink-0 rounded-md bg-emerald-400/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">FLAC</span>
          <span v-if="track.traits?.includes('atmos')" class="shrink-0 rounded-md bg-cyan-400/10 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-300">ATMOS</span>
          <span v-else-if="track.traits?.includes('hi-res-lossless')" class="shrink-0 rounded-md bg-sky-400/10 px-1.5 py-0.5 text-[10px] font-semibold text-sky-300">Hi-Res</span>
          <span v-if="track.vipOnly" class="shrink-0 rounded-md bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">VIP</span>
          <span v-if="track.blocked" class="inline-flex shrink-0 items-center gap-0.5 rounded-md bg-rose-400/10 px-1.5 py-0.5 text-[10px] font-semibold text-rose-300">
            <Ban :size="9" /> 已屏蔽
          </span>
        </div>
        <p class="mt-1 truncate text-xs text-zinc-500">
          <RouterLink v-if="track.artistMids?.[0]" :to="{ path: `/artist/${track.artistMids[0]}`, query: { provider: track.provider } }" class="transition hover:text-violet-300">
            {{ track.artists.join(' / ') }}
          </RouterLink>
          <span v-else>{{ track.artists.join(' / ') }}</span>
          <span v-if="props.showAlbum && track.album">
            ·
            <RouterLink v-if="track.albumId" :to="{ path: `/album/${track.albumId}`, query: { provider: track.provider } }" class="transition hover:text-violet-300">{{ track.album }}</RouterLink>
            <template v-else>{{ track.album }}</template>
          </span>
          <span v-if="track.year"> · {{ track.year }}</span>
        </p>
        <p class="mt-0.5 flex items-center gap-1 text-[11px] text-zinc-600 sm:hidden">
          <Clock3 :size="10" /> {{ formatDuration(track.durationMs) }}
        </p>
      </div>

      <div class="hidden shrink-0 items-center gap-1.5 text-[11px] text-zinc-600 sm:flex">
        {{ formatDuration(track.durationMs) }}
      </div>

      <div class="flex shrink-0 items-center gap-2">
        <button
          v-if="track.provider === 'apple' && track.sourceUrl"
          class="grid h-8 w-8 place-items-center rounded-xl border border-white/10 bg-white/[0.05] text-zinc-200 transition hover:border-rose-400/40 hover:bg-rose-500/15 hover:text-white"
          :title="player.track?.id === track.id && player.playing ? '暂停' : '在线播放'"
          @click="player.track?.id === track.id && player.playing ? player.toggle() : player.play(track, props.tracks)"
        >
          <Pause v-if="player.track?.id === track.id && player.playing" :size="14" />
          <Play v-else :size="14" />
        </button>
        <select
          :value="qualityOf(track)"
          :disabled="track.blocked || isDownloaded(track)"
          class="hidden appearance-none rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5 text-[11px] text-zinc-300 outline-none transition hover:border-white/20 disabled:opacity-40 sm:block"
          @change="choices[track.id] = ($event.target as HTMLSelectElement).value as Quality"
        >
          <option v-for="q in track.qualities" :key="q" :value="q">{{ QUALITY_LABEL[q] }}</option>
          <option v-if="!track.qualities.includes('hires')" value="hires">Hi-Res（尝试）</option>
        </select>
        <button
          v-if="isDownloaded(track)"
          :disabled="busy[track.id]"
          class="flex items-center gap-1.5 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-2.5 py-2 text-xs font-medium text-emerald-300/80 transition hover:border-emerald-400/40 hover:bg-emerald-500/20 hover:text-emerald-200 disabled:opacity-50 sm:px-3"
          title="已在媒体库 · 点击可强制重新下载"
          @click="download(track, true)"
        >
          <Loader2 v-if="busy[track.id]" :size="14" class="animate-spin" />
          <CheckCheck v-else :size="14" />
          <span class="hidden sm:inline">已下载</span>
        </button>
        <button
          v-else
          :disabled="busy[track.id] || track.blocked"
          class="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.05] px-2.5 py-2 text-xs font-medium text-zinc-200 transition hover:border-violet-400/40 hover:bg-violet-500/15 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 sm:px-3"
          @click="download(track)"
        >
          <Loader2 v-if="busy[track.id]" :size="14" class="animate-spin" />
          <Download v-else :size="14" />
          <span class="hidden sm:inline">下载</span>
        </button>
      </div>
    </article>
  </div>
</template>
