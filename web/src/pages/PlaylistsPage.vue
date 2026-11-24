<script setup lang="ts">
import PageHeader from '@/components/PageHeader.vue'
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { ListMusic, Heart, Loader2, Download, Music2, Users, Timer, RefreshCw, Trash2, Plus, CheckCircle2, Link2 } from 'lucide-vue-next'
import { api, type Quality, type Track } from '@/lib/api'
import { useAppStore } from '@/stores/app'
import { useTasksStore } from '@/stores/tasks'
import { useToast } from '@/stores/toast'
import { useDialogStore } from '@/stores/dialog'
import TrackList from '@/components/TrackList.vue'

const app = useAppStore()
const tasks = useTasksStore()
const toast = useToast()
const dialog = useDialogStore()

interface PlaylistItem {
  id: string
  name: string
  cover: string
  count: number
  dirid: number
}

const accountId = ref<number | null>(null)
const lists = ref<PlaylistItem[]>([])
const selected = ref<PlaylistItem | null>(null)
const tracks = ref<Track[]>([])
const loading = ref(false)
const loadingTracks = ref(false)
const loadingId = ref<string | null>(null)
const trackError = ref('')
const displayLimit = ref(200)
const panelRef = ref<HTMLElement | null>(null)
const downloading = ref(false)
const subscriptions = ref<any[]>([])
const subInterval = ref(30)
const subscribing = ref(false)
const importInput = ref('')
const importing = ref(false)
const nowTs = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | null = null

const intervals = [15, 30, 60, 180, 720]
const alreadySubscribed = computed(
  () => !!selected.value && subscriptions.value.some((s) => s.target_id === selected.value!.id && s.account_id === accountId.value),
)

function nextIn(sub: any): string {
  if (!sub.next_scan_at) return sub.enabled ? '待扫描' : '已暂停'
  const diff = new Date(sub.next_scan_at).getTime() - nowTs.value
  if (diff <= 0) return '即将扫描'
  const total = Math.floor(diff / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m ${String(s).padStart(2, '0')}s`
}

async function loadSubscriptions() {
  const data = await api<{ subscriptions: any[] }>('/subscriptions')
  subscriptions.value = data.subscriptions
}

async function subscribe() {
  if (!selected.value || !accountId.value) return
  subscribing.value = true
  try {
    await api('/subscriptions', {
      method: 'POST',
      body: JSON.stringify({
        accountId: accountId.value,
        playlistId: selected.value.id,
        name: selected.value.name,
        intervalMin: subInterval.value,
      }),
    })
    await loadSubscriptions()
    toast.success(`已订阅「${selected.value.name}」，每 ${subInterval.value} 分钟扫描`)
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '订阅失败')
  } finally {
    subscribing.value = false
  }
}

async function toggleSub(sub: any) {
  try {
    await api(`/subscriptions/${sub.id}`, {
      method: 'PUT',
      body: JSON.stringify({ enabled: !sub.enabled }),
    })
    await loadSubscriptions()
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '操作失败')
  }
}

async function changeInterval(sub: any, value: number) {
  try {
    await api(`/subscriptions/${sub.id}`, {
      method: 'PUT',
      body: JSON.stringify({ intervalMin: value }),
    })
    await loadSubscriptions()
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '修改失败')
  }
}

async function scanNow(sub: any) {
  try {
    const res = await api<{ message: string }>(`/subscriptions/${sub.id}/scan`, { method: 'POST' })
    toast.success(res.message)
    await loadSubscriptions()
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '扫描失败')
  }
}

async function removeSub(sub: any) {
  if (!(await dialog.confirm({ title: '取消订阅', message: `取消订阅「${sub.name}」？已下载的文件不会删除。` }))) return
  try {
    await api(`/subscriptions/${sub.id}`, { method: 'DELETE' })
    await loadSubscriptions()
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '取消失败')
  }
}

const currentAccount = computed(() => app.accounts.find((a) => a.id === accountId.value))
const displayTracks = computed(() => tracks.value.slice(0, displayLimit.value))

function selectAccount(id: number) {
  accountId.value = id
  localStorage.setItem('sq_pl_account', String(id))
  loadLists()
}

async function loadLists() {
  if (!accountId.value) return
  loading.value = true
  selected.value = null
  tracks.value = []
  try {
    const data = await api<{ playlists: PlaylistItem[] }>(`/accounts/${accountId.value}/playlists`)
    lists.value = data.playlists
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '读取歌单失败')
    lists.value = []
  } finally {
    loading.value = false
  }
}

async function openPlaylist(item: PlaylistItem) {
  selected.value = item
  loadingTracks.value = true
  loadingId.value = item.id
  trackError.value = ''
  tracks.value = []
  displayLimit.value = 200
  await nextTick()
  panelRef.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  try {
    const data = await api<{ playlist: { tracks: Track[] } }>(`/playlists/${item.id}?accountId=${accountId.value}`)
    tracks.value = data.playlist.tracks
  } catch (err) {
    trackError.value = err instanceof Error ? err.message : '读取歌单歌曲失败'
    toast.error(trackError.value)
  } finally {
    loadingTracks.value = false
    loadingId.value = null
  }
}

async function importPlaylist() {
  const value = importInput.value.trim()
  if (!value) return
  importing.value = true
  trackError.value = ''
  try {
    const data = await api<{ playlist: PlaylistItem & { tracks: Track[] } }>('/playlists/resolve', {
      method: 'POST',
      body: JSON.stringify({ url: value, accountId: accountId.value }),
    })
    const playlist = data.playlist
    selected.value = {
      id: playlist.id,
      name: playlist.name || '导入的歌单',
      cover: '',
      count: playlist.tracks.length,
      dirid: 0,
    }
    tracks.value = playlist.tracks
    displayLimit.value = 200
    importInput.value = ''
    await nextTick()
    panelRef.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    toast.success(`已导入「${selected.value.name}」，共 ${tracks.value.length} 首`)
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '导入歌单失败')
  } finally {
    importing.value = false
  }
}

async function downloadAll() {
  if (!tracks.value.length) return
  downloading.value = true
  const quality = (app.settings?.quality || 'flac') as Quality
  let count = 0
  try {
    for (const track of tracks.value) {
      if (track.blocked) continue
      try {
        const res = await tasks.create(track, quality)
        if (!res.skipped) count += 1
      } catch {
        /* ignore single failure */
      }
    }
    toast.success(`已加入 ${count} 首到下载队列`)
  } finally {
    downloading.value = false
  }
}

onMounted(async () => {
  await Promise.all([app.loadAccounts(), app.loadSettings()])
  const stored = Number(localStorage.getItem('sq_pl_account')) || 0
  accountId.value =
    (stored && app.accounts.some((a) => a.id === stored) ? stored : null) ||
    app.settings?.downloadAccountId ||
    app.accounts[0]?.id ||
    null
  await Promise.all([loadLists(), loadSubscriptions()])
  ticker = setInterval(() => (nowTs.value = Date.now()), 1000)
})
onUnmounted(() => {
  if (ticker) clearInterval(ticker)
})
</script>

<template>
  <div class="space-y-6">
    <PageHeader label="Playlists" title="歌单与我喜欢" desc="读取账号的歌单和「我喜欢」，用统一下载账号批量下载">
      <template #actions>
        <div class="k-seg max-w-full flex-wrap">
          <button
            v-for="a in app.accounts"
            :key="a.id"
            class="k-seg-item"
            :class="accountId === a.id ? 'k-seg-active' : ''"
            @click="selectAccount(a.id)"
          >{{ a.alias || a.nickname }}</button>
        </div>
      </template>
    </PageHeader>

    <div v-if="app.accounts.length" class="rise flex flex-wrap gap-2">
      <div class="relative min-w-[260px] flex-1">
        <Link2 :size="14" class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
        <input
          v-model="importInput"
          class="w-full rounded-xl border border-white/10 bg-white/[0.03] py-2 pl-8 pr-3 text-xs text-zinc-200 outline-none transition placeholder:text-zinc-600 focus:border-violet-400/40"
          placeholder="粘贴 QQ / 网易云 / 汽水歌单链接或歌单 ID"
          @keyup.enter="importPlaylist"
        />
      </div>
      <button
        :disabled="importing || !importInput.trim()"
        class="flex items-center gap-1.5 rounded-xl border border-violet-400/20 bg-violet-500/10 px-3.5 py-2 text-xs font-medium text-violet-200 transition hover:bg-violet-500/15 disabled:opacity-50"
        @click="importPlaylist"
      >
        <Loader2 v-if="importing" :size="13" class="animate-spin" />
        <Download v-else :size="13" />
        {{ importing ? '导入中' : '按链接/ID 导入' }}
      </button>
    </div>

    <div v-if="!app.accounts.length" class="rise glass flex flex-col items-center rounded-3xl py-16 text-center">
      <div class="grid h-14 w-14 place-items-center rounded-2xl border border-white/10 bg-white/[0.03] text-zinc-600"><Users :size="22" /></div>
      <p class="mt-4 text-sm text-zinc-400">请先绑定 QQ 音乐账号</p>
      <RouterLink to="/accounts" class="mt-4 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-xs text-zinc-300">去绑定</RouterLink>
    </div>

    <template v-else>
      <section v-if="subscriptions.length" class="rise glass rounded-3xl p-4">
        <div class="flex items-center justify-between">
          <h2 class="flex items-center gap-2 text-sm font-semibold"><Timer :size="14" class="text-violet-300" /> 自动扫描订阅</h2>
          <span class="text-[10px] text-zinc-600">按设定间隔检查新增歌曲并自动下载</span>
        </div>
        <div class="mt-3 space-y-2">
          <div v-for="sub in subscriptions" :key="sub.id" class="flex flex-wrap items-center gap-2 rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-2.5">
            <CheckCircle2 :size="13" :class="sub.enabled ? 'text-emerald-300' : 'text-zinc-600'" />
            <div class="min-w-0 flex-1">
              <p class="truncate text-xs text-zinc-200">{{ sub.name }}</p>
              <p class="truncate text-[10px] text-zinc-500">{{ sub.accountName }} · {{ sub.last_message || '尚未扫描' }}</p>
            </div>
            <span class="rounded-md bg-white/[0.05] px-2 py-1 text-[10px] tabular-nums text-zinc-400">{{ nextIn(sub) }}</span>
            <select
              :value="sub.interval_min"
              class="appearance-none rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] text-zinc-300 outline-none"
              @change="changeInterval(sub, Number(($event.target as HTMLSelectElement).value))"
            >
              <option v-for="m in intervals" :key="m" :value="m">每 {{ m >= 60 ? m / 60 + ' 小时' : m + ' 分钟' }}</option>
            </select>
            <button class="grid h-7 w-7 place-items-center rounded-lg text-zinc-500 transition hover:bg-white/5 hover:text-zinc-200" title="立即扫描" @click="scanNow(sub)">
              <RefreshCw :size="12" />
            </button>
            <button class="rounded-lg px-2 py-1 text-[10px]" :class="sub.enabled ? 'text-emerald-300 hover:bg-white/5' : 'text-zinc-500 hover:bg-white/5'" @click="toggleSub(sub)">
              {{ sub.enabled ? '运行中' : '已暂停' }}
            </button>
            <button class="grid h-7 w-7 place-items-center rounded-lg text-zinc-500 transition hover:bg-rose-500/10 hover:text-rose-300" title="取消订阅" @click="removeSub(sub)">
              <Trash2 :size="12" />
            </button>
          </div>
        </div>
      </section>

      <section v-if="loading" class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <div v-for="i in 5" :key="i" class="skeleton h-40 rounded-2xl" />
      </section>

      <section v-else class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <button
          v-for="item in lists"
          :key="item.id"
          class="group overflow-hidden rounded-2xl border p-2.5 text-left transition"
          :class="selected?.id === item.id ? 'border-violet-400/40 bg-violet-500/10' : 'border-white/[0.06] bg-white/[0.02] hover:border-violet-400/30 hover:bg-white/[0.05]'"
          @click="openPlaylist(item)"
        >
          <div class="relative aspect-square overflow-hidden rounded-xl bg-gradient-to-br from-zinc-800 to-zinc-900">
            <img v-if="item.cover" :src="item.cover" class="h-full w-full object-cover transition duration-500 group-hover:scale-105" alt="" loading="lazy" />
            <div v-else class="grid h-full w-full place-items-center text-zinc-600">
              <Heart v-if="item.dirid === 201 || item.dirid === 5" :size="30" class="text-rose-300/70" />
              <ListMusic v-else :size="30" />
            </div>
            <div v-if="loadingId === item.id" class="absolute inset-0 grid place-items-center bg-black/40">
              <Loader2 :size="24" class="animate-spin text-white" />
            </div>
          </div>
          <p class="mt-2 truncate text-xs font-medium text-zinc-200">{{ item.name }}</p>
          <p class="mt-0.5 text-[11px] text-zinc-500">{{ item.count }} 首</p>
        </button>
      </section>

      <section v-if="selected" ref="panelRef" class="rise space-y-3 scroll-mt-24">
        <div class="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
          <div class="min-w-0">
            <p class="truncate text-sm font-medium text-zinc-200">{{ selected.name }}</p>
            <p class="mt-0.5 text-[11px] text-zinc-500">{{ tracks.length }} 首 · 由 {{ currentAccount?.alias || currentAccount?.nickname }} 读取</p>
          </div>
          <div class="flex items-center gap-2">
            <template v-if="!alreadySubscribed">
              <select v-model.number="subInterval" class="appearance-none rounded-lg border border-white/10 bg-white/[0.04] px-2 py-2 text-[10px] text-zinc-300 outline-none">
                <option v-for="m in intervals" :key="m" :value="m">每 {{ m >= 60 ? m / 60 + ' 小时' : m + ' 分钟' }}</option>
              </select>
              <button
                :disabled="subscribing"
                class="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2 text-xs text-zinc-200 transition hover:border-violet-400/40 disabled:opacity-50"
                @click="subscribe"
              >
                <Plus :size="13" /> 订阅
              </button>
            </template>
            <span v-else class="rounded-lg bg-emerald-400/10 px-2.5 py-2 text-[10px] text-emerald-300">已订阅</span>
            <button
              :disabled="downloading || !tracks.length"
              class="flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-cyan-500 px-4 py-2 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
              @click="downloadAll"
            >
              <Loader2 v-if="downloading" :size="14" class="animate-spin" />
              <Download v-else :size="14" />
              全部下载
            </button>
          </div>
        </div>

        <div v-if="loadingTracks" class="space-y-2">
          <div v-for="i in 6" :key="i" class="skeleton h-16 rounded-2xl" />
        </div>
        <p v-else-if="trackError" class="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-xs text-rose-300">
          {{ trackError }}
        </p>
        <template v-else>
          <p class="px-1 text-[11px] text-zinc-600">共 {{ tracks.length }} 首，已显示 {{ displayTracks.length }} 首</p>
          <TrackList :tracks="displayTracks" />
          <div v-if="tracks.length > displayTracks.length" class="flex justify-center pt-2">
            <button class="rounded-full border border-white/10 bg-white/[0.04] px-5 py-2 text-xs text-zinc-300 transition hover:border-violet-400/40" @click="displayLimit += 300">
              加载更多（剩余 {{ tracks.length - displayTracks.length }} 首）
            </button>
          </div>
        </template>
      </section>

      <div v-else-if="!loading && !lists.length" class="glass flex flex-col items-center rounded-3xl py-16 text-center">
        <div class="grid h-14 w-14 place-items-center rounded-2xl border border-white/10 bg-white/[0.03] text-zinc-600"><Music2 :size="22" /></div>
        <p class="mt-4 text-sm text-zinc-400">这个账号还没有可见的歌单</p>
      </div>
    </template>
  </div>
</template>
