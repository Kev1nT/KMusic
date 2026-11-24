<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  Search,
  ArrowRight,
  Download,
  HardDrive,
  Music4,
  Timer,
  Loader2,
  TrendingUp,
  Clock3,
  Users,
  Music2,
  Library,
  ListMusic,
  Disc3,
  Sparkles,
} from 'lucide-vue-next'
import { api } from '@/lib/api'
import { formatBytes, timeAgo } from '@/lib/format'
import { useAppStore } from '@/stores/app'
import PageHeader from '@/components/PageHeader.vue'

const router = useRouter()
const app = useAppStore()
const word = ref('')
const data = ref<any>(null)
const loading = ref(true)
const nowTs = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | null = null
let refresher: ReturnType<typeof setInterval> | null = null

const greeting = computed(() => {
  const h = new Date().getHours()
  if (h < 6) return '夜深了'
  if (h < 12) return '早上好'
  if (h < 18) return '下午好'
  return '晚上好'
})

const countdown = computed(() => {
  if (!data.value?.nextScanAt) return null
  const diff = new Date(data.value.nextScanAt).getTime() - nowTs.value
  if (diff <= 0) return '即将开始'
  const total = Math.floor(diff / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0 ? `${h} 小时 ${m} 分` : `${m} 分 ${String(s).padStart(2, '0')} 秒`
})

const maxSeries = computed(() => Math.max(1, ...(data.value?.series || []).map((d: any) => d.count)))

const stats = computed(() => [
  { label: '今日下载', value: data.value?.today.count ?? 0, unit: '首', sub: formatBytes(data.value?.today.bytes ?? 0), icon: Download, tint: 'text-violet-300' },
  { label: '近 7 天', value: data.value?.week.count ?? 0, unit: '首', sub: formatBytes(data.value?.week.bytes ?? 0), icon: TrendingUp, tint: 'text-cyan-300' },
  { label: '媒体库', value: data.value?.total.count ?? 0, unit: '首', sub: '累计入库', icon: Music4, tint: 'text-emerald-300' },
  { label: '占用空间', value: formatBytes(data.value?.total.bytes ?? 0), unit: '', sub: '音频文件总计', icon: HardDrive, tint: 'text-amber-300' },
])

const shortcuts = [
  { label: '搜索下载', desc: '多平台聚合搜索', icon: Search, to: 'search', tint: 'from-violet-500/25' },
  { label: 'Apple Music', desc: '无损 · 全景声 · 试听', icon: Music2, to: 'apple', tint: 'from-rose-500/25' },
  { label: '媒体库', desc: '已入库的全部曲目', icon: Library, to: 'library', tint: 'from-cyan-500/25' },
  { label: '歌单订阅', desc: '自动扫描追更', icon: ListMusic, to: 'playlists', tint: 'from-emerald-500/25' },
]

function goSearch() {
  const q = word.value.trim()
  router.push({ name: 'search', query: q ? { q } : {} })
}
async function load() {
  try {
    data.value = await api('/dashboard')
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  app.loadSettings().catch(() => {})
  load()
  ticker = setInterval(() => (nowTs.value = Date.now()), 1000)
  refresher = setInterval(() => void load().catch(() => {}), 20_000)
})
onUnmounted(() => {
  if (ticker) clearInterval(ticker)
  if (refresher) clearInterval(refresher)
})
</script>

<template>
  <div class="space-y-6">
    <PageHeader label="Dashboard" :title="`${greeting}，今天想听点什么？`" desc="下载动态、媒体库概览与自动扫描进度，一屏掌握" />

    <!-- 搜索 -->
    <form
      class="rise flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] p-2 transition focus-within:border-violet-400/40 focus-within:ring-4 focus-within:ring-violet-500/10"
      @submit.prevent="goSearch"
    >
      <Search :size="19" class="ml-2 shrink-0 text-zinc-500" />
      <input
        v-model="word"
        class="min-w-0 flex-1 bg-transparent px-1 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
        placeholder="搜索单曲、专辑或艺术家…"
      />
      <button type="submit" class="k-btn k-btn-primary">
        搜索 <ArrowRight :size="13" />
      </button>
    </form>

    <!-- 快捷入口 -->
    <section class="rise grid grid-cols-2 gap-3 lg:grid-cols-4">
      <RouterLink
        v-for="s in shortcuts"
        :key="s.to"
        :to="{ name: s.to }"
        class="k-tile group p-4"
      >
        <div class="flex items-center justify-between">
          <div class="grid h-9 w-9 place-items-center rounded-xl bg-white/[0.08] text-zinc-100">
            <component :is="s.icon" :size="17" />
          </div>
          <ArrowRight :size="15" class="text-zinc-600 transition group-hover:translate-x-0.5 group-hover:text-zinc-300" />
        </div>
        <p class="mt-3 text-sm font-medium text-zinc-100">{{ s.label }}</p>
        <p class="mt-0.5 text-[11px] text-zinc-500">{{ s.desc }}</p>
      </RouterLink>
    </section>

    <!-- 统计 -->
    <section class="rise grid grid-cols-2 gap-3 lg:grid-cols-4">
      <div v-for="st in stats" :key="st.label" class="k-card p-4">
        <div class="flex items-center gap-2 text-[11px] text-zinc-500">
          <component :is="st.icon" :size="13" :class="st.tint" /> {{ st.label }}
        </div>
        <p class="mt-2 text-2xl font-semibold tabular-nums text-zinc-50">
          {{ st.value }}<span v-if="st.unit" class="ml-1 text-xs font-normal text-zinc-500">{{ st.unit }}</span>
        </p>
        <p class="mt-0.5 text-[10px] text-zinc-600">{{ st.sub }}</p>
      </div>
    </section>

    <div class="grid gap-4 lg:grid-cols-3">
      <div class="space-y-4 lg:col-span-2">
        <!-- 正在运行 -->
        <section class="rise k-card p-5">
          <div class="flex items-center justify-between">
            <h2 class="flex items-center gap-2 text-sm font-semibold"><Sparkles :size="14" class="text-violet-300" /> 正在运行</h2>
            <RouterLink to="/tasks" class="text-[11px] text-zinc-500 transition hover:text-zinc-300">全部任务 →</RouterLink>
          </div>
          <div v-if="loading" class="mt-4 space-y-2">
            <div v-for="i in 2" :key="i" class="skeleton h-12 rounded-xl" />
          </div>
          <div v-else-if="data?.active?.length" class="mt-3 space-y-2">
            <div v-for="task in data.active" :key="task.id" class="rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-2.5">
              <div class="flex items-center gap-3">
                <Loader2 :size="14" class="shrink-0 animate-spin text-violet-300" />
                <p class="min-w-0 flex-1 truncate text-xs text-zinc-200">{{ task.title }} <span class="text-zinc-500">· {{ task.artists }}</span></p>
                <span class="text-[10px] tabular-nums text-zinc-500">{{ task.progress }}%</span>
              </div>
              <div class="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.06]">
                <div class="h-full rounded-full bg-gradient-to-r from-violet-500 to-cyan-400 transition-all" :style="{ width: `${Math.max(3, task.progress)}%` }" />
              </div>
            </div>
          </div>
          <div v-else class="mt-4 flex items-center gap-2 text-xs text-zinc-500">
            <span class="h-1.5 w-1.5 rounded-full bg-emerald-400" /> 当前没有运行中的任务
          </div>
        </section>

        <!-- 最近下载 -->
        <section class="rise k-card p-5">
          <div class="flex items-center justify-between">
            <h2 class="flex items-center gap-2 text-sm font-semibold"><Clock3 :size="14" class="text-cyan-300" /> 最近下载</h2>
            <RouterLink to="/library" class="text-[11px] text-zinc-500 transition hover:text-zinc-300">媒体库 →</RouterLink>
          </div>
          <div v-if="data?.recent?.length" class="mt-2 divide-y divide-white/[0.04]">
            <div v-for="task in data.recent" :key="task.id" class="flex items-center gap-3 py-2.5">
              <div class="h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-zinc-800">
                <img v-if="task.cover" :src="task.cover" class="h-full w-full object-cover" alt="" loading="lazy" />
                <div v-else class="grid h-full w-full place-items-center text-zinc-600"><Disc3 :size="15" /></div>
              </div>
              <div class="min-w-0 flex-1">
                <p class="truncate text-xs text-zinc-200">{{ task.title }}</p>
                <p class="truncate text-[10px] text-zinc-500">{{ task.artists }}</p>
              </div>
              <span class="shrink-0 text-[10px] text-zinc-600">{{ timeAgo(task.updated_at) }}</span>
            </div>
          </div>
          <p v-else class="mt-4 text-xs text-zinc-500">还没有下载记录，去搜索页找首歌吧。</p>
        </section>
      </div>

      <div class="space-y-4">
        <!-- 自动扫描 -->
        <section class="rise overflow-hidden rounded-3xl border border-violet-400/20 bg-gradient-to-br from-violet-500/[0.16] to-cyan-500/[0.05] p-5">
          <div class="flex items-center gap-2 text-[11px] text-violet-200/80"><Timer :size="13" /> 下次自动扫描</div>
          <p class="mt-3 text-lg font-semibold text-zinc-100">{{ countdown || '暂无订阅' }}</p>
          <p class="mt-1 text-[11px] text-zinc-500">
            {{ data?.subscriptions?.enabled ? `${data.subscriptions.enabled} 个订阅运行中` : '在歌单页订阅后自动扫描' }}
          </p>
          <RouterLink to="/playlists" class="mt-4 inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[11px] text-zinc-200 transition hover:bg-white/[0.1]">
            管理订阅 <ArrowRight :size="11" />
          </RouterLink>
        </section>

        <!-- 趋势 -->
        <section class="rise k-card p-5">
          <h2 class="flex items-center gap-2 text-sm font-semibold"><TrendingUp :size="14" class="text-cyan-300" /> 近 7 天趋势</h2>
          <div class="mt-4 flex h-28 items-end gap-1.5">
            <div v-for="day in data?.series || []" :key="day.date" class="flex flex-1 flex-col items-center gap-1.5">
              <div class="flex w-full flex-1 items-end">
                <div class="w-full rounded-md bg-gradient-to-t from-violet-600/60 to-cyan-400/70 transition-all" :style="{ height: `${Math.max(4, (day.count / maxSeries) * 100)}%` }" />
              </div>
              <span class="text-[9px] text-zinc-600">{{ day.date.slice(5) }}</span>
            </div>
          </div>
        </section>

        <!-- 账号贡献 -->
        <section class="rise k-card p-5">
          <h2 class="flex items-center gap-2 text-sm font-semibold"><Users :size="14" class="text-emerald-300" /> 账号贡献</h2>
          <div v-if="data?.byAccount?.length" class="mt-3 space-y-2.5">
            <div v-for="acc in data.byAccount" :key="acc.id" class="flex items-center gap-2">
              <span class="min-w-0 flex-1 truncate text-[11px] text-zinc-300">{{ acc.name }}</span>
              <span class="text-[11px] tabular-nums text-zinc-500">{{ acc.count }} 首</span>
              <span class="w-14 text-right text-[10px] tabular-nums text-zinc-600">{{ formatBytes(acc.bytes) }}</span>
            </div>
          </div>
          <p v-else class="mt-3 text-[11px] text-zinc-500">还没有下载数据</p>
        </section>
      </div>
    </div>
  </div>
</template>
