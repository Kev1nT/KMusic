<script setup lang="ts">
import { computed, ref } from 'vue'
import { Copy, Loader2, Sparkles, Trash2, ShieldCheck } from 'lucide-vue-next'
import { api } from '@/lib/api'
import { formatBytes, formatDuration } from '@/lib/format'
import { useToast } from '@/stores/toast'
import { useDialogStore } from '@/stores/dialog'

interface DupFile {
  path: string
  title: string
  artist: string
  album: string
  durationMs: number
  size: number
  ext: string
  bitrate: number
  codec: string
  md5?: string
  keep?: boolean
}
interface DupGroup {
  key: string
  title: string
  artist: string
  durationMs: number
  confidence: 'high' | 'medium' | 'low'
  matchType: 'exact' | 'metadata'
  keep: string
  reclaimBytes: number
  files: DupFile[]
}
interface DupResult {
  scanned: number
  totalGroups: number
  totalFiles: number
  reclaimBytes: number
  groups: DupGroup[]
}

const toast = useToast()
const dialog = useDialogStore()
const dupes = ref<DupResult | null>(null)
const dupeLoading = ref(false)
const selected = ref<Set<string>>(new Set())
const deleteMode = ref<'trash' | 'permanent'>('trash')
const deleting = ref(false)

const selectedCount = computed(() => selected.value.size)
const selectedBytes = computed(() => {
  if (!dupes.value) return 0
  let bytes = 0
  for (const group of dupes.value.groups) for (const file of group.files) if (selected.value.has(file.path)) bytes += file.size
  return bytes
})

async function scanDuplicates() {
  dupeLoading.value = true
  try {
    const data = await api<DupResult>('/library/duplicates', { method: 'POST' })
    dupes.value = data
    const next = new Set<string>()
    for (const group of data.groups) if (group.matchType === 'exact') for (const file of group.files) if (!file.keep) next.add(file.path)
    selected.value = next
    toast.success(data.totalGroups ? `找到 ${data.totalGroups} 组重复，可释放 ${formatBytes(data.reclaimBytes)}` : '没有发现重复歌曲')
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '扫描重复失败')
  } finally {
    dupeLoading.value = false
  }
}

function selectAll() {
  const next = new Set<string>()
  if (dupes.value) for (const group of dupes.value.groups) for (const file of group.files) if (!file.keep) next.add(file.path)
  selected.value = next
}
function clearSelection() {
  selected.value = new Set()
}
function toggleFile(path: string) {
  const next = new Set(selected.value)
  next.has(path) ? next.delete(path) : next.add(path)
  selected.value = next
}
function groupAllSelected(group: DupGroup) {
  return group.files.filter((file) => !file.keep).every((file) => selected.value.has(file.path))
}
function toggleGroup(group: DupGroup) {
  const next = new Set(selected.value)
  if (groupAllSelected(group)) for (const file of group.files) next.delete(file.path)
  else for (const file of group.files) if (!file.keep) next.add(file.path)
  selected.value = next
}

async function deleteSelected() {
  if (!selected.value.size) return
  const paths = [...selected.value]
  const modeText = deleteMode.value === 'permanent' ? '彻底删除（不可恢复）' : '移到回收站'
  if (!(await dialog.confirm({ title: '删除重复文件', message: `确定${modeText} ${paths.length} 个文件？可释放约 ${formatBytes(selectedBytes.value)}`, danger: true }))) return
  deleting.value = true
  try {
    const res = await api<{ deleted: number; errors: unknown[] }>('/library/delete', {
      method: 'POST',
      body: JSON.stringify({ paths, mode: deleteMode.value }),
    })
    toast.success(`已删除 ${res.deleted} 个文件${res.errors.length ? `，${res.errors.length} 个失败` : ''}`)
    await scanDuplicates()
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '删除失败')
  } finally {
    deleting.value = false
  }
}

async function autoDelete() {
  const modeText = deleteMode.value === 'permanent' ? '彻底删除（不可恢复）' : '移到回收站'
  if (!(await dialog.confirm({ title: '自动清理重复', message: `将自动保留每组音质最好的一份，其余重复文件${modeText}。确定继续？`, danger: true }))) return
  deleting.value = true
  try {
    const res = await api<{ deleted: number; targets: number; reclaimBytes: number }>('/library/auto-dedupe', {
      method: 'POST',
      body: JSON.stringify({ mode: deleteMode.value }),
    })
    toast.success(`自动清理完成：删除 ${res.deleted} / ${res.targets} 个，释放约 ${formatBytes(res.reclaimBytes)}`)
    await scanDuplicates()
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '自动清理失败')
  } finally {
    deleting.value = false
  }
}

defineExpose({ scanDuplicates })
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div class="flex items-center gap-2">
          <Copy :size="15" class="text-cyan-300" />
          <h2 class="text-sm font-semibold text-zinc-100">重复歌曲</h2>
          <span v-if="dupes?.totalGroups" class="rounded-full bg-cyan-400/10 px-2 py-0.5 text-[10px] text-cyan-200">
            {{ dupes.totalGroups }} 组 · {{ dupes.totalFiles }} 个文件
          </span>
          <span v-else-if="dupes" class="text-[11px] text-emerald-300">没有发现重复</span>
        </div>
        <p class="mt-1.5 max-w-2xl text-[11px] leading-relaxed text-zinc-600">
          按「歌手 + 标题 + 时长（±5 秒）+ 版本特征」分组；同尺寸文件再做 MD5 校验。自动清理会删除同版本低音质副本，保留最好的一份（默认移到回收站）。
          <span v-if="dupes?.reclaimBytes" class="text-zinc-500">可释放约 {{ formatBytes(dupes.reclaimBytes) }}。</span>
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <button
          :disabled="dupeLoading"
          class="flex items-center gap-1.5 rounded-xl border border-cyan-400/20 bg-cyan-400/10 px-3 py-2 text-[11px] font-medium text-cyan-200 disabled:opacity-50"
          @click="scanDuplicates"
        >
          <Loader2 v-if="dupeLoading" :size="12" class="animate-spin" />
          <Copy v-else :size="12" />
          {{ dupeLoading ? '扫描中' : '开始扫描重复' }}
        </button>
        <template v-if="dupes?.totalGroups">
          <select v-model="deleteMode" class="rounded-xl border border-white/10 bg-white/[0.04] px-2.5 py-2 text-[11px] text-zinc-300 outline-none">
            <option value="trash">删除到回收站</option>
            <option value="permanent">彻底删除</option>
          </select>
          <button class="rounded-xl border border-white/10 bg-white/[0.04] px-2.5 py-2 text-[11px] text-zinc-300" @click="selectedCount ? clearSelection() : selectAll()">
            {{ selectedCount ? '清空选择' : '全选重复' }}
          </button>
          <button :disabled="deleting" class="flex items-center gap-1.5 rounded-xl border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-[11px] text-amber-200 disabled:opacity-50" @click="autoDelete">
            <Sparkles :size="12" /> 自动清理（保留最佳）
          </button>
          <button :disabled="deleting || !selectedCount" class="flex items-center gap-1.5 rounded-xl border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200 disabled:opacity-50" @click="deleteSelected">
            <Loader2 v-if="deleting" :size="12" class="animate-spin" />
            <Trash2 v-else :size="12" />
            删除选中（{{ selectedCount }}）{{ selectedCount ? ` · ${formatBytes(selectedBytes)}` : '' }}
          </button>
        </template>
      </div>
    </div>

    <div v-if="!dupes" class="glass rounded-2xl px-4 py-10 text-center text-xs text-zinc-600">点击「开始扫描重复」按需扫描，不会在进入媒体库时自动加载。</div>
    <div v-else class="space-y-2.5">
      <article v-for="group in dupes.groups" :key="group.key" class="overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02]">
        <div class="flex flex-wrap items-center gap-2 border-b border-white/[0.05] px-3.5 py-2.5">
          <input type="checkbox" class="h-3.5 w-3.5 accent-violet-500" :checked="groupAllSelected(group)" @change="toggleGroup(group)" />
          <h3 class="text-xs font-semibold text-zinc-200">{{ group.title }}</h3>
          <span class="truncate text-[10px] text-zinc-500">{{ group.artist }}</span>
          <span class="rounded bg-white/[0.05] px-1.5 py-0.5 text-[9px] uppercase text-zinc-500">{{ group.confidence === 'high' ? '高置信' : '需人工确认' }}</span>
          <span v-if="group.matchType === 'exact'" class="rounded bg-cyan-400/10 px-1.5 py-0.5 text-[9px] text-cyan-200">MD5 相同</span>
          <span class="ml-auto text-[10px] text-zinc-600">{{ group.files.length }} 份 · 可释放 {{ formatBytes(group.reclaimBytes) }}</span>
        </div>
        <div class="divide-y divide-white/[0.04]">
          <label v-for="file in group.files" :key="file.path" class="flex cursor-pointer items-center gap-2.5 px-3.5 py-2 transition hover:bg-white/[0.03]">
            <input type="checkbox" class="h-3.5 w-3.5 accent-violet-500" :checked="selected.has(file.path)" @change="toggleFile(file.path)" />
            <span class="w-10 shrink-0 rounded bg-white/[0.05] px-1.5 py-0.5 text-center text-[9px] uppercase text-zinc-400">{{ file.ext }}</span>
            <span class="min-w-0 flex-1 truncate font-mono text-[10px] text-zinc-500" :title="file.path">{{ file.path }}</span>
            <span v-if="file.keep" class="flex shrink-0 items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-0.5 text-[9px] text-emerald-300"><ShieldCheck :size="10" /> 建议保留</span>
            <span class="shrink-0 text-[10px] tabular-nums text-zinc-600">{{ formatDuration(file.durationMs) }}</span>
            <span class="shrink-0 text-[10px] tabular-nums text-zinc-600">{{ formatBytes(file.size) }}</span>
          </label>
        </div>
      </article>
    </div>
  </div>
</template>
