<script setup lang="ts">
import { computed } from 'vue'
import { Play, Pause, SkipBack, SkipForward, ChevronDown, Loader2, Music2, X, Mic2 } from 'lucide-vue-next'
import { LyricPlayer, BackgroundRender } from '@applemusic-like-lyrics/vue'
import '@applemusic-like-lyrics/core/style.css'
import { usePlayerStore } from '@/stores/player'
import { formatDuration } from '@/lib/format'

const player = usePlayerStore()

const pct = computed(() => (player.durationMs ? Math.min(100, (player.currentMs / player.durationMs) * 100) : 0))

function onSeek(e: Event) {
  const v = Number((e.target as HTMLInputElement).value)
  player.seek((v / 100) * player.durationMs)
}
function onLineClick(e: any) {
  const t = e?.line?.getLine?.()?.startTime
  if (typeof t === 'number') player.seek(t)
}

function closeAll() {
  player.expanded = false
  player.stop()
}
</script>

<template>
  <div v-if="player.track">
    <!-- 底部迷你条 -->
    <div class="fixed inset-x-0 bottom-0 z-50 border-t border-white/10 bg-[#0b0d12]/95 backdrop-blur-xl">
      <div class="mx-auto flex max-w-7xl items-center gap-3 px-3 py-2.5 sm:gap-4 sm:px-6">
        <button class="flex min-w-0 flex-1 items-center gap-3 text-left" @click="player.expanded = true">
          <div class="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-zinc-800">
            <img v-if="player.track.cover" :src="player.track.cover" class="h-full w-full object-cover" alt="" />
            <div v-else class="grid h-full w-full place-items-center text-zinc-600"><Music2 :size="18" /></div>
          </div>
          <div class="min-w-0 flex-1">
            <p class="truncate text-xs font-medium text-zinc-100">{{ player.track.title }}</p>
            <p class="truncate text-[11px] text-zinc-500">{{ player.track.artists.join(' / ') }}</p>
          </div>
        </button>
        <div class="hidden flex-1 items-center gap-2 md:flex">
          <span class="w-9 shrink-0 text-right text-[10px] tabular-nums text-zinc-500">{{ formatDuration(player.currentMs) }}</span>
          <input type="range" min="0" max="100" step="0.1" :value="pct" class="am-range h-1 flex-1" :style="{ background: `linear-gradient(to right,#fb7185 ${pct}%, rgba(255,255,255,.22) ${pct}%)` }" @input="onSeek" />
          <span class="w-9 shrink-0 text-[10px] tabular-nums text-zinc-500">{{ formatDuration(player.durationMs) }}</span>
        </div>
        <button class="grid h-8 w-8 place-items-center rounded-lg text-zinc-400 transition hover:bg-white/5 hover:text-zinc-200 disabled:opacity-30" :disabled="!player.hasPrev" title="上一首" @click="player.prev()">
          <SkipBack :size="16" />
        </button>
        <button class="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-zinc-200 transition hover:bg-white/20" :title="player.playing ? '暂停' : '播放'" @click="player.toggle()">
          <Loader2 v-if="player.preparing" :size="16" class="animate-spin" />
          <Pause v-else-if="player.playing" :size="16" />
          <Play v-else :size="16" class="translate-x-[1px]" />
        </button>
        <button class="grid h-8 w-8 place-items-center rounded-lg text-zinc-400 transition hover:bg-white/5 hover:text-zinc-200 disabled:opacity-30" :disabled="!player.hasNext" title="下一首" @click="player.next()">
          <SkipForward :size="16" />
        </button>
        <button class="grid h-8 w-8 place-items-center rounded-lg text-zinc-500 transition hover:bg-white/5 hover:text-zinc-300" title="关闭" @click="closeAll">
          <X :size="15" />
        </button>
      </div>
      <div v-if="player.preparing" class="px-6 pb-1 text-[10px] text-zinc-500">正在准备音频（首次播放需下载）… {{ Math.round(player.prepPct) }}%</div>
      <div v-else-if="player.error" class="px-6 pb-1 text-[10px] text-rose-400">{{ player.error }}</div>
    </div>

    <!-- 全屏播放页（仿 Apple Music） -->
    <Transition name="player">
      <div v-if="player.expanded" class="fixed inset-0 z-[60] overflow-hidden bg-[#070708]">
        <!-- amll 动态背景（Apple Music 风格流体渐变） -->
        <div class="absolute inset-0 overflow-hidden">
          <div class="absolute inset-0 opacity-80">
            <BackgroundRender
              :album="player.track.cover || ''"
              :playing="player.playing"
              :has-lyric="player.showLyrics"
              :fps="30"
              :flow-speed="2"
              style="position: absolute; top: 0; left: 0; width: 100%; height: 100%"
            />
          </div>
          <div class="absolute inset-0 bg-gradient-to-b from-black/25 via-black/45 to-black/85" />
        </div>

        <div class="relative flex h-full flex-col">
          <!-- 顶栏 -->
          <div class="flex items-center justify-between px-5 pt-[max(1rem,env(safe-area-inset-top))]">
            <button class="grid h-9 w-9 place-items-center rounded-full text-zinc-300 transition hover:bg-white/10" @click="player.expanded = false">
              <ChevronDown :size="20" />
            </button>
            <span class="text-[11px] uppercase tracking-[0.18em] text-zinc-400">正在播放</span>
            <button class="grid h-9 w-9 place-items-center rounded-full text-zinc-300 transition hover:bg-white/10" :title="player.showLyrics ? '显示封面' : '显示歌词'" @click="player.showLyrics = !player.showLyrics">
              <Mic2 :size="17" :class="player.showLyrics ? 'text-rose-300' : ''" />
            </button>
          </div>

          <!-- 主区：封面 / 歌词 -->
          <div class="relative min-h-0 flex-1 px-6">
            <Transition name="fade">
              <div v-if="!player.showLyrics" class="grid h-full place-items-center" @click="player.showLyrics = true">
                <div class="aspect-square w-full max-w-[min(78vw,26rem)] overflow-hidden rounded-2xl shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)] ring-1 ring-white/10">
                  <img v-if="player.track.cover" :src="player.track.cover" class="h-full w-full object-cover" alt="" />
                  <div v-else class="grid h-full w-full place-items-center bg-zinc-800 text-zinc-600"><Music2 :size="48" /></div>
                </div>
              </div>
            </Transition>
            <div v-if="player.showLyrics" class="relative h-full">
              <LyricPlayer
                v-if="player.lyricLines.length"
                :lyric-lines="player.lyricLines"
                :current-time="player.currentMs"
                :playing="player.playing"
                :align-anchor="'center'"
                :enable-spring="true"
                :enable-blur="true"
                :enable-scale="true"
                style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; mix-blend-mode: plus-lighter"
                @line-click="onLineClick"
              />
              <div v-else class="grid h-full place-items-center text-sm text-zinc-500">暂无逐字歌词</div>
            </div>
          </div>

          <!-- 底部信息与控制 -->
          <div class="px-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3">
            <div class="mb-2 flex items-end justify-between gap-4">
              <div class="min-w-0">
                <p class="truncate text-lg font-semibold text-white">{{ player.track.title }}</p>
                <p class="truncate text-sm text-zinc-400">{{ player.track.artists.join(' / ') }}</p>
              </div>
              <span v-if="player.track.traits?.includes('atmos')" class="shrink-0 rounded-md bg-cyan-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-300">ATMOS</span>
            </div>

            <div class="flex items-center gap-2">
              <span class="w-9 shrink-0 text-[10px] tabular-nums text-zinc-500">{{ formatDuration(player.currentMs) }}</span>
              <input type="range" min="0" max="100" step="0.1" :value="pct" class="am-range h-1 flex-1" :style="{ background: `linear-gradient(to right,#ffffff ${pct}%, rgba(255,255,255,.22) ${pct}%)` }" @input="onSeek" />
              <span class="w-9 shrink-0 text-right text-[10px] tabular-nums text-zinc-500">{{ formatDuration(player.durationMs) }}</span>
            </div>

            <div class="mt-3 flex items-center justify-center gap-10">
              <button class="text-zinc-200 transition hover:text-white disabled:opacity-30" :disabled="!player.hasPrev" @click="player.prev()">
                <SkipBack :size="30" fill="currentColor" />
              </button>
              <button class="grid h-16 w-16 place-items-center rounded-full text-white transition active:scale-95" @click="player.toggle()">
                <Loader2 v-if="player.preparing" :size="30" class="animate-spin" />
                <Play v-else-if="!player.playing" :size="32" fill="currentColor" class="translate-x-[2px]" />
                <Pause v-else :size="32" fill="currentColor" />
              </button>
              <button class="text-zinc-200 transition hover:text-white disabled:opacity-30" :disabled="!player.hasNext" @click="player.next()">
                <SkipForward :size="30" fill="currentColor" />
              </button>
            </div>
            <div class="mt-2 flex items-center justify-center">
              <button class="rounded-lg px-3 py-1 text-xs text-zinc-400 transition hover:text-zinc-200" @click="player.showLyrics = !player.showLyrics">
                {{ player.showLyrics ? '显示封面' : '显示歌词' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.am-range {
  -webkit-appearance: none;
  appearance: none;
  border-radius: 999px;
  outline: none;
  cursor: pointer;
}
.am-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.45);
  transition: transform 0.15s ease;
}
.am-range:hover::-webkit-slider-thumb {
  transform: scale(1.25);
}
.am-range::-moz-range-thumb {
  width: 12px;
  height: 12px;
  border: 0;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.45);
}
.player-enter-active,
.player-leave-active {
  transition: transform 0.42s cubic-bezier(0.22, 0.61, 0.36, 1), opacity 0.3s ease;
}
.player-enter-from,
.player-leave-to {
  transform: translateY(100%);
  opacity: 0.4;
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
