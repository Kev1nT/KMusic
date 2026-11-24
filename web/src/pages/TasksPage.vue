<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  ArrowDownToLine,
  Loader2,
  RotateCcw,
  X,
  Music2,
  CheckCircle2,
  CircleSlash,
  Inbox,
  Trash2,
} from 'lucide-vue-next'
import { useTasksStore } from '@/stores/tasks'
import { formatBytes, STATUS_META, timeAgo } from '@/lib/format'
import { QUALITY_LABEL, type Quality } from '@/lib/api'
import { useToast } from '@/stores/toast'
import PageHeader from '@/components/PageHeader.vue'

const store = useTasksStore()
const toast = useToast()
const filter = ref<'all' | 'active' | 'done' | 'failed'>('all')
const retryingAll = ref(false)
const clearing = ref(false)
const repairing = ref(false)

const filters = [
  { key: 'all', label: '全部' },
  { key: 'active', label: '进行中' },
  { key: 'done', label: '已完成' },
  { key: 'failed', label: '失败' },
] as const

const activeStatuses = ['queued', 'resolving', 'downloading', 'verifying', 'tagging']

const list = computed(() => {
  const rows = store.tasks
  if (filter.value === 'active') return rows.filter((t) => activeStatuses.includes(t.status))
  if (filter.value === 'done') return rows.filter((t) => t.status === 'done')
  if (filter.value === 'failed') return rows.filter((t) => t.status === 'failed')
  return rows
})

const counts = computed(() => ({
  active: store.tasks.filter((t) => activeStatuses.includes(t.status)).length,
  done: store.tasks.filter((t) => t.status === 'done').length,
  failed: store.tasks.filter((t) => t.status === 'failed').length,
}))

async function retryAllFailed() {
  if (!store.totalFailed || retryingAll.value) return
  retryingAll.value = true
  try {
    const d = await store.retryAllFailed()
    toast.success(`已重新排队 ${d.count} 个失败任务${d.remaining ? `（还剩 ${d.remaining} 个）` : ''}`)
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '批量重试失败')
  } finally {
    retryingAll.value = false
  }
}

async function removeTask(id: number) {
  try {
    await store.remove(id)
    toast.push('已清除任务记录')
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '清除失败')
  }
}

const qishuiFailed = computed(() => store.tasks.filter((t) => t.provider === 'qishui' && t.status === 'failed').length)

async function repairQishui() {
  if (repairing.value) return
  repairing.value = true
  try {
    const d = await store.retryAllFailed('qishui')
    toast.success(
      `已重新排队 ${d.count} 个汽水任务，会自动匹配新曲目${d.remaining ? `（还剩 ${d.remaining} 个，再点一次继续）` : ''}`,
    )
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '修复失败')
  } finally {
    repairing.value = false
  }
}

async function clearFailed() {
  if (clearing.value) return
  clearing.value = true
  try {
    const n = await store.clear('failed')
    toast.success(`已清除 ${n} 条失败记录`)
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '清除失败')
  } finally {
    clearing.value = false
  }
}

async function retry(id: number) {
  try {
    await store.retry(id)
    toast.success('已重新加入队列')
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '重试失败')
  }
}

async function cancel(id: number) {
  try {
    await store.cancel(id)
    toast.push('任务已取消')
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '取消失败')
  }
}

onMounted(() => store.startPolling())
onUnmounted(() => store.stopPolling())
</script>

<template>
  <div class="space-y-7">
    <PageHeader label="Downloads" title="下载队列" desc="任务会自动重试并校验音频完整性">
      <template #actions>
        <div class="flex flex-wrap items-center gap-4 text-xs text-zinc-500">
          <span>进行中 <b class="text-violet-300">{{ counts.active }}</b></span>
          <span>完成 <b class="text-emerald-300">{{ counts.done }}</b></span>
          <span>失败 <b class="text-rose-300">{{ store.totalFailed }}</b></span>
          <button
            v-if="store.totalFailed"
            :disabled="retryingAll"
            class="flex items-center gap-1.5 rounded-full border border-rose-400/20 bg-rose-500/10 px-3 py-1.5 font-medium text-rose-200 transition hover:border-rose-400/40 hover:bg-rose-500/15 disabled:opacity-50"
            @click="retryAllFailed"
          >
            <Loader2 v-if="retryingAll" :size="12" class="animate-spin" />
            <RotateCcw v-else :size="12" />
            {{ retryingAll ? '正在重试' : `重试全部失败（${store.totalFailed}）` }}
          </button>
          <button
            v-if="qishuiFailed"
            :disabled="repairing"
            class="flex items-center gap-1.5 rounded-full border border-cyan-400/25 bg-cyan-500/10 px-3 py-1.5 font-medium text-cyan-200 transition hover:border-cyan-400/50 hover:bg-cyan-500/20 disabled:opacity-50"
            title="按歌名+歌手自动匹配汽水新曲目并重新下载"
            @click="repairQishui"
          >
            <Loader2 v-if="repairing" :size="12" class="animate-spin" />
            <RotateCcw v-else :size="12" />
            自动修复汽水曲目（{{ qishuiFailed }}）
          </button>
          <button
            v-if="store.totalFailed"
            :disabled="clearing"
            class="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 font-medium text-zinc-300 transition hover:border-white/20 hover:text-white disabled:opacity-50"
            @click="clearFailed"
          >
            <Loader2 v-if="clearing" :size="12" class="animate-spin" />
            <Trash2 v-else :size="12" />
            清除失败记录
          </button>
        </div>
      </template>
    </PageHeader>

    <div class="rise k-seg">
      <button
        v-for="f in filters"
        :key="f.key"
        class="k-seg-item"
        :class="filter === f.key ? 'k-seg-active' : ''"
        @click="filter = f.key"
      >
        {{ f.label }}
      </button>
    </div>

    <div v-if="!list.length" class="rise glass flex flex-col items-center justify-center rounded-3xl py-20 text-center">
      <div class="grid h-14 w-14 place-items-center rounded-2xl border border-white/10 bg-white/[0.03] text-zinc-600">
        <Inbox :size="24" />
      </div>
      <p class="mt-4 text-sm text-zinc-400">{{ filter === 'all' ? '还没有下载任务' : '这个分类下暂无任务' }}</p>
      <RouterLink to="/search" class="mt-4 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-xs text-zinc-300 transition hover:border-violet-400/40">
        去搜索音乐
      </RouterLink>
    </div>

    <div v-else class="space-y-2.5">
      <article
        v-for="task in list"
        :key="task.id"
        class="rise glass rounded-2xl p-3.5 transition hover:border-white/[0.12] sm:p-4"
      >
        <div class="flex items-center gap-3.5">
          <div class="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-zinc-800 to-zinc-900">
            <img v-if="task.cover" :src="task.cover" class="h-full w-full object-cover" alt="" loading="lazy" />
            <div v-else class="grid h-full w-full place-items-center text-zinc-600"><Music2 :size="17" /></div>
          </div>

          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <h3 class="truncate text-sm font-medium text-zinc-100">{{ task.title }}</h3>
              <span class="shrink-0 rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-zinc-400">
                {{ task.quality ? QUALITY_LABEL[task.quality as Quality] : '自动' }}
              </span>
            </div>
            <p class="mt-0.5 truncate text-[11px] text-zinc-500">
              {{ task.artists }}<span v-if="task.album"> · {{ task.album }}</span>
            </p>
          </div>

          <div class="hidden shrink-0 text-right sm:block">
            <span class="rounded-full px-2.5 py-1 text-[10px] font-medium" :class="STATUS_META[task.status]?.tone || 'text-zinc-400 bg-white/5'">
              {{ STATUS_META[task.status]?.label || task.status }}
            </span>
            <p class="mt-1 text-[10px] text-zinc-600">{{ timeAgo(task.updated_at) }}</p>
          </div>

          <div class="flex shrink-0 items-center gap-1">
            <button
              v-if="task.status === 'failed'"
              class="grid h-8 w-8 place-items-center rounded-lg text-zinc-500 transition hover:bg-white/5 hover:text-zinc-200"
              title="重试"
              @click="retry(task.id)"
            >
              <RotateCcw :size="14" />
            </button>
            <button
              v-if="activeStatuses.includes(task.status)"
              class="grid h-8 w-8 place-items-center rounded-lg text-zinc-500 transition hover:bg-rose-500/10 hover:text-rose-300"
              title="取消"
              @click="cancel(task.id)"
            >
              <X :size="14" />
            </button>
            <CheckCircle2 v-if="task.status === 'done'" :size="16" class="text-emerald-400/70" />
            <CircleSlash v-if="task.status === 'canceled'" :size="16" class="text-zinc-600" />
            <button
              v-if="!activeStatuses.includes(task.status)"
              class="grid h-8 w-8 place-items-center rounded-lg text-zinc-600 transition hover:bg-rose-500/10 hover:text-rose-300"
              title="清除这条记录"
              @click="removeTask(task.id)"
            >
              <Trash2 :size="14" />
            </button>
          </div>
        </div>

        <div v-if="activeStatuses.includes(task.status)" class="mt-3 space-y-1.5">
          <div class="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
            <div
              class="h-full rounded-full bg-gradient-to-r from-violet-500 to-cyan-400 transition-all duration-500"
              :style="{ width: `${Math.max(3, task.progress)}%` }"
            />
          </div>
          <div class="flex justify-between text-[10px] text-zinc-600">
            <span class="flex items-center gap-1"><Loader2 :size="10" class="animate-spin" /> {{ task.progress }}%</span>
            <span>{{ task.total_bytes ? formatBytes(task.total_bytes) : '计算中' }}</span>
          </div>
        </div>

        <div v-else-if="task.status === 'done'" class="mt-2.5 flex items-center justify-between gap-3 border-t border-white/[0.05] pt-2.5">
          <p class="truncate font-mono text-[10px] text-zinc-600">{{ task.file_path }}</p>
          <span class="shrink-0 text-[10px] text-zinc-500">{{ formatBytes(task.received_bytes) }}</span>
        </div>

        <p v-else-if="task.error" class="mt-2.5 rounded-lg bg-rose-500/[0.07] px-2.5 py-2 text-[11px] leading-relaxed text-rose-300/90">
          {{ task.error }}
        </p>
      </article>
    </div>
  </div>
</template>
