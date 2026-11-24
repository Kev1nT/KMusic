<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { X, Pause, Play, Trash2, Terminal, ArrowDownToLine } from 'lucide-vue-next'
import { api } from '@/lib/api'

const open = defineModel<boolean>('open', { default: false })

interface LogEntry {
  seq: number
  ts: number
  level: 'debug' | 'info' | 'warn' | 'error'
  scope: string
  msg: string
  detail?: string
}

const logs = ref<LogEntry[]>([])
const lastSeq = ref(0)
const paused = ref(false)
const loading = ref(false)
const box = ref<HTMLElement | null>(null)
let timer: ReturnType<typeof setInterval> | null = null

const LEVEL_STYLE: Record<string, string> = {
  debug: 'text-zinc-500 bg-zinc-500/10',
  info: 'text-sky-300 bg-sky-400/10',
  warn: 'text-amber-300 bg-amber-400/10',
  error: 'text-rose-300 bg-rose-400/10',
}
const LEVEL_LABEL: Record<string, string> = { debug: '调试', info: '信息', warn: '警告', error: '错误' }

function timeOf(ts: number) {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

function scrollBottom() {
  nextTick(() => {
    if (box.value) box.value.scrollTop = box.value.scrollHeight
  })
}

async function pull() {
  if (!open.value) return
  try {
    const r = await api<{ logs: LogEntry[]; seq: number }>(`/logs?after=${lastSeq.value || 0}&limit=500`)
    if (r.logs?.length) {
      logs.value = [...logs.value, ...r.logs].slice(-2000)
      lastSeq.value = r.logs[r.logs.length - 1].seq
      if (!paused.value) scrollBottom()
    } else if (r.seq) {
      lastSeq.value = r.seq
    }
  } catch {
    /* 忽略轮询失败 */
  }
}

async function bootstrap() {
  loading.value = true
  try {
    const r = await api<{ logs: LogEntry[]; seq: number }>('/logs?limit=800')
    logs.value = r.logs || []
    lastSeq.value = logs.value.length ? logs.value[logs.value.length - 1].seq : r.seq || 0
    scrollBottom()
  } finally {
    loading.value = false
  }
}

function togglePause() {
  paused.value = !paused.value
  if (!paused.value) {
    void pull()
    scrollBottom()
  }
}
function clearLogs() {
  logs.value = []
}
function onScroll() {
  const el = box.value
  if (!el) return
  // 手动往上翻时自动暂停滚动，翻回底部再恢复
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  paused.value = !atBottom
}

watch(open, (v) => {
  if (v) {
    if (!logs.value.length) void bootstrap()
    else scrollBottom()
    if (!timer) timer = setInterval(pull, 1500)
  } else if (timer) {
    clearInterval(timer)
    timer = null
  }
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})

const count = computed(() => logs.value.length)
</script>

<template>
  <Teleport to="body">
    <Transition name="logslide">
      <div v-if="open" class="fixed inset-y-0 right-0 z-[70] flex w-full max-w-[560px] flex-col border-l border-white/10 bg-[#0b0d12]/97 shadow-2xl shadow-black/60 backdrop-blur-2xl">
        <!-- 头 -->
        <div class="flex items-center gap-3 border-b border-white/[0.07] px-4 py-3">
          <Terminal :size="16" class="text-violet-300" />
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium text-zinc-100">程序日志</p>
            <p class="text-[10px] text-zinc-500">
              {{ count }} 条 · {{ paused ? '已停止滚动（新日志仍在追加）' : '实时滚动中' }}
            </p>
          </div>
          <button
            class="flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11px] transition"
            :class="paused ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200' : 'border-white/10 bg-white/[0.04] text-zinc-300 hover:text-white'"
            @click="togglePause"
          >
            <Play v-if="paused" :size="12" />
            <Pause v-else :size="12" />
            {{ paused ? '继续滚动' : '停止滚动' }}
          </button>
          <button class="grid h-7 w-7 place-items-center rounded-lg text-zinc-500 transition hover:bg-white/5 hover:text-zinc-200" title="清空显示" @click="clearLogs">
            <Trash2 :size="13" />
          </button>
          <button class="grid h-7 w-7 place-items-center rounded-lg text-zinc-500 transition hover:bg-white/5 hover:text-zinc-200" title="关闭" @click="open = false">
            <X :size="15" />
          </button>
        </div>

        <!-- 日志列表 -->
        <div ref="box" class="min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-[11.5px] leading-relaxed" @scroll="onScroll">
          <div v-if="loading" class="space-y-2 p-2">
            <div v-for="i in 6" :key="i" class="skeleton h-4 rounded" />
          </div>
          <div v-else-if="!logs.length" class="grid h-full place-items-center text-center text-zinc-600">
            <div>
              <Terminal :size="28" class="mx-auto mb-2 opacity-40" />
              <p class="text-xs">暂无日志</p>
              <p class="mt-1 text-[10px] text-zinc-700">下载、补缺、扫描等操作会实时出现在这里</p>
            </div>
          </div>
          <div v-else class="space-y-0.5">
            <div v-for="e in logs" :key="e.seq" class="flex items-start gap-2 rounded-lg px-1.5 py-1 transition hover:bg-white/[0.03]">
              <span class="shrink-0 text-zinc-600">{{ timeOf(e.ts) }}</span>
              <span class="shrink-0 rounded px-1 py-0.5 text-[10px] font-semibold" :class="LEVEL_STYLE[e.level]">{{ LEVEL_LABEL[e.level] || e.level }}</span>
              <span class="shrink-0 rounded bg-white/[0.05] px-1 py-0.5 text-[10px] text-zinc-400">{{ e.scope }}</span>
              <span class="min-w-0 flex-1 break-all text-zinc-200">
                {{ e.msg }}
                <span v-if="e.detail" class="text-zinc-500"> · {{ e.detail }}</span>
              </span>
            </div>
          </div>
        </div>

        <!-- 底部提示 -->
        <div class="flex items-center justify-between border-t border-white/[0.07] px-4 py-2 text-[10px] text-zinc-600">
          <span>数据来自服务端运行日志（与 docker logs 同源）</span>
          <button v-if="paused" class="flex items-center gap-1 text-violet-300 transition hover:text-violet-200" @click="togglePause">
            <ArrowDownToLine :size="11" /> 跳到最新
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.logslide-enter-active,
.logslide-leave-active {
  transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.2s ease;
}
.logslide-enter-from,
.logslide-leave-to {
  transform: translateX(100%);
  opacity: 0.6;
}
</style>
