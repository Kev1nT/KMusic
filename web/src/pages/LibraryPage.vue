<script setup lang="ts">
import PageHeader from '@/components/PageHeader.vue'
import { computed, onMounted, ref } from 'vue'
import {
  Library,
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  FileAudio,
  FileText,
  ArrowLeft,
  Plus,
  Pencil,
  Copy,
  Move,
  Trash2,
  RefreshCw,
  Loader2,
  Tags,
  SearchCheck,
  Languages,
  Sparkles,
  Wand2,
  CheckSquare,
  Square,
  X,
} from 'lucide-vue-next'
import { api } from '@/lib/api'
import { formatBytes, formatDuration } from '@/lib/format'
import { useToast } from '@/stores/toast'
import { useDialogStore } from '@/stores/dialog'
import { useAppStore } from '@/stores/app'
import DuplicatesPanel from '@/components/DuplicatesPanel.vue'

interface RootItem { path: string; name: string }
interface TreeNode { name: string; path: string; depth: number; open: boolean; loaded: boolean }
interface FileItem { name: string; path: string; size: number; mtime: number; ext: string; isAudio: boolean }
interface DirItem { name: string; path: string }
interface DirListing { path: string; root: string; parent: string | null; dirs: DirItem[]; files: FileItem[] }
interface TagInfo {
  path: string
  tags: { title: string; artist: string; album: string; year: string; track: string }
  durationMs: number
  bitrate: number
  codec: string
  hasEmbeddedCover: boolean
  coverPath: string | null
  lyricPath: string | null
  nfoPath: string | null
}
interface MissingItem { path: string; title: string; artist: string; missing: string[] }

const toast = useToast()
const dialog = useDialogStore()
const app = useAppStore()
const tab = ref<'files' | 'duplicates'>('files')
const roots = ref<RootItem[]>([])
const nodes = ref<TreeNode[]>([])
const current = ref<DirListing | null>(null)
const loading = ref(false)
const listing = ref(false)
const rootsLoading = ref(true)
const selectedPaths = ref<Set<string>>(new Set())
const fileDeleteMode = ref<'trash' | 'permanent'>('trash')
const indexing = ref(false)

const tagOpen = ref(false)
const tagLoading = ref(false)
const tagSaving = ref(false)
const tagInfo = ref<TagInfo | null>(null)
const tagForm = ref({ title: '', artist: '', album: '', year: '', track: '' })

const missing = ref<{ scanned: number; missing: number; items: MissingItem[] } | null>(null)
const missingLoading = ref(false)
const fixing = ref(false)
const organizeOpen = ref(false)
const organizePaths = ref<string[]>([])
const organizeRoot = ref('')
const organizeTemplate = ref('')
const organizePreview = ref<any>(null)
const organizeLoading = ref(false)
const organizeExecuting = ref(false)
const missingOpen = ref(false)
const missingTarget = ref('')
const missingScanning = ref(false)
const missingChecks = ref({ tags: true, lyric: true, cover: true, nfo: true })

const selectedCount = computed(() => selectedPaths.value.size)
const selectedBytes = computed(() => {
  if (!current.value) return 0
  return current.value.files.filter((file) => selectedPaths.value.has(file.path)).reduce((sum, file) => sum + file.size, 0)
})
const selectedAudio = computed(() => current.value?.files.find((file) => selectedPaths.value.has(file.path)) || null)
const allSelected = computed(() => {
  if (!current.value) return false
  const all = [...current.value.dirs, ...current.value.files].map((item) => item.path)
  return all.length > 0 && all.every((path) => selectedPaths.value.has(path))
})

function toggleSelect(path: string) {
  const next = new Set(selectedPaths.value)
  next.has(path) ? next.delete(path) : next.add(path)
  selectedPaths.value = next
}

function toggleSelectAll() {
  if (!current.value) return
  if (allSelected.value) {
    selectedPaths.value = new Set()
    return
  }
  selectedPaths.value = new Set([...current.value.dirs, ...current.value.files].map((item) => item.path))
}

async function loadRoots() {
  rootsLoading.value = true
  try {
    const data = await api<{ roots: RootItem[] }>('/files/roots')
    roots.value = data.roots
    nodes.value = data.roots.map((root) => ({ name: root.name, path: root.path, depth: 0, open: false, loaded: false }))
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '读取媒体库根目录失败')
  } finally {
    rootsLoading.value = false
  }
}

async function toggleNode(node: TreeNode) {
  const index = nodes.value.findIndex((item) => item.path === node.path)
  if (index < 0) return
  if (node.open) {
    let end = index + 1
    while (end < nodes.value.length && nodes.value[end].depth > node.depth) end++
    nodes.value.splice(index + 1, end - index - 1)
    node.open = false
    return
  }
  try {
    const data = await api<DirListing>(`/files/list?path=${encodeURIComponent(node.path)}`)
    node.open = true
    node.loaded = true
    let end = index + 1
    while (end < nodes.value.length && nodes.value[end].depth > node.depth) end++
    const children = data.dirs.map((dir) => ({
      name: dir.name,
      path: dir.path,
      depth: node.depth + 1,
      open: false,
      loaded: false,
    }))
    nodes.value.splice(index + 1, end - index - 1, ...children)
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '展开目录失败')
  }
}

async function openDir(path: string) {
  listing.value = true
  selectedPaths.value = new Set()
  try {
    current.value = await api<DirListing>(`/files/list?path=${encodeURIComponent(path)}`)
    missing.value = null
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '读取目录失败')
  } finally {
    listing.value = false
  }
}

async function clickNode(node: TreeNode) {
  await openDir(node.path)
  if (!node.open) await toggleNode(node)
}

async function goParent() {
  if (current.value?.parent) await openDir(current.value.parent)
}

async function refresh() {
  if (current.value) await openDir(current.value.path)
  await loadRoots()
}

function targetPaths() {
  return selectedPaths.value.size ? [...selectedPaths.value] : current.value ? [current.value.path] : []
}

async function renameSelected() {
  if (selectedCount.value !== 1) {
    toast.push('请只选择一个文件或目录')
    return
  }
  const input = [...selectedPaths.value][0]
  const old = input.split('/').pop() || input
  const name = await dialog.prompt({ title: '重命名', message: '请输入新名称', value: old })
  if (!name || name === old) return
  try {
    await api('/files/rename', { method: 'POST', body: JSON.stringify({ path: input, newName: name }) })
    toast.success('重命名成功')
    await refresh()
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '重命名失败')
  }
}

async function mkdir() {
  if (!current.value) return
  const name = await dialog.prompt({ title: '新建文件夹', message: '文件夹名称', placeholder: '例如：新专辑' })
  if (!name) return
  try {
    await api('/files/mkdir', { method: 'POST', body: JSON.stringify({ parent: current.value.path, name }) })
    toast.success('已创建目录')
    await refresh()
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '创建失败')
  }
}

async function copySelected() {
  if (!selectedCount.value || !current.value) return
  const dest = await dialog.prompt({ title: '复制到目录', message: '目标目录（绝对路径）', value: current.value.path })
  if (!dest) return
  try {
    await api('/files/copy', { method: 'POST', body: JSON.stringify({ paths: [...selectedPaths.value], dest }) })
    toast.success('复制完成')
    await refresh()
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '复制失败')
  }
}

async function moveSelected() {
  if (!selectedCount.value || !current.value) return
  const dest = await dialog.prompt({ title: '移动到目录', message: '目标目录（绝对路径）', value: current.value.path })
  if (!dest) return
  try {
    await api('/files/move', { method: 'POST', body: JSON.stringify({ paths: [...selectedPaths.value], dest }) })
    toast.success('移动完成')
    await refresh()
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '移动失败')
  }
}

async function deleteSelected() {
  if (!selectedCount.value) return
  const modeText = fileDeleteMode.value === 'permanent' ? '彻底删除（不可恢复）' : '移到回收站'
  if (!(await dialog.confirm({ title: '删除确认', message: `${modeText} ${selectedCount.value} 个文件/目录？`, danger: true }))) return
  try {
    const res = await api<{ deleted: number; errors: unknown[] }>('/files/delete', {
      method: 'POST',
      body: JSON.stringify({ paths: [...selectedPaths.value], mode: fileDeleteMode.value }),
    })
    toast.success(`删除 ${res.deleted} 个${res.errors.length ? `，${res.errors.length} 个失败` : ''}`)
    await refresh()
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '删除失败')
  }
}

async function openTagModal(file?: FileItem | null) {
  if (!file || !file.isAudio) {
    toast.push('只能编辑音频文件的标签')
    return
  }
  tagOpen.value = true
  tagLoading.value = true
  try {
    const info = await api<TagInfo>(`/files/tags?path=${encodeURIComponent(file.path)}`)
    tagInfo.value = info
    tagForm.value = { ...info.tags }
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '读取标签失败')
    tagOpen.value = false
  } finally {
    tagLoading.value = false
  }
}

async function saveTags() {
  if (!tagInfo.value) return
  tagSaving.value = true
  try {
    await api('/files/tags', {
      method: 'POST',
      body: JSON.stringify({ path: tagInfo.value.path, tags: tagForm.value }),
    })
    toast.success('标签已保存')
    tagOpen.value = false
    await refresh()
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '保存标签失败')
  } finally {
    tagSaving.value = false
  }
}

function openMissingDialog() {
  if (!current.value) return
  const selectedDirs = [...selectedPaths.value].filter((path) => current.value!.dirs.some((dir) => dir.path === path))
  missingTarget.value = selectedDirs[0] || current.value.path
  missingChecks.value = { tags: true, lyric: true, cover: true, nfo: true }
  missingOpen.value = true
}

async function startMissingScan() {
  if (!missingTarget.value) return
  missingScanning.value = true
  missingLoading.value = true
  try {
    missing.value = await api(`/files/missing/scan`, {
      method: 'POST',
      body: JSON.stringify({ path: missingTarget.value, checks: missingChecks.value }),
    })
    missingOpen.value = false
    toast.success(`扫描 ${missing.value.scanned} 首，发现 ${missing.value.missing} 首有缺项`)
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '查缺失败')
  } finally {
    missingScanning.value = false
    missingLoading.value = false
  }
}

async function fixAllMissing() {
  if (!missing.value?.items.length) return
  if (!(await dialog.confirm({ title: '自动刮削', message: `将尝试自动刮削补充 ${missing.value.items.length} 首歌曲的缺失项，可能较慢。继续？` }))) return
  fixing.value = true
  try {
    const res = await api<{ fixed: number; errors: unknown[] }>('/files/missing/fix', {
      method: 'POST',
      body: JSON.stringify({ paths: missing.value.items.map((item) => item.path), checks: missingChecks.value }),
    })
    toast.success(`已补充 ${res.fixed} 首${res.errors.length ? `，${res.errors.length} 首失败` : ''}`)
    await scanMissing()
    await refresh()
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '自动刮削失败')
  } finally {
    fixing.value = false
  }
}

async function openOrganizeDialog() {
  if (!current.value) return
  const paths = selectedPaths.value.size ? [...selectedPaths.value] : [current.value.path]
  const selectedDirs = [...selectedPaths.value].filter((path) => current.value!.dirs.some((dir) => dir.path === path))
  organizePaths.value = paths
  organizeRoot.value = selectedDirs[0] || current.value.path
  organizePreview.value = null
  try {
    const data = await api<{ settings: { template: string } }>('/settings')
    organizeTemplate.value = data.settings.template
  } catch {
    organizeTemplate.value = '{artist}/{album}/{track:02d} - {title}'
  }
  organizeOpen.value = true
}

async function previewOrganize() {
  if (!organizeRoot.value.trim() || !organizeTemplate.value.trim()) return
  organizeLoading.value = true
  try {
    organizePreview.value = await api('/files/organize', {
      method: 'POST',
      body: JSON.stringify({ paths: organizePaths.value, root: organizeRoot.value, template: organizeTemplate.value, dryRun: true }),
    })
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '预览失败')
  } finally {
    organizeLoading.value = false
  }
}

async function executeOrganize() {
  if (!organizePreview.value || !organizePreview.value.moved) return
  if (!(await dialog.confirm({ title: '开始整理', message: `将移动 ${organizePreview.value.moved} 首歌曲到目标目录，是否继续？`, danger: true }))) return
  organizeExecuting.value = true
  try {
    const res = await api('/files/organize', {
      method: 'POST',
      body: JSON.stringify({ paths: organizePaths.value, root: organizeRoot.value, template: organizeTemplate.value, dryRun: false }),
    })
    toast.success(`整理完成：移动 ${res.moved} 首，跳过 ${res.skipped}，冲突 ${res.conflicts}，失败 ${res.errors}`)
    organizeOpen.value = false
    await refresh()
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '整理失败')
  } finally {
    organizeExecuting.value = false
  }
}

async function convertNames() {
  const paths = targetPaths()
  if (!paths.length) return
  const answer = await dialog.prompt({ title: '简繁转换', message: '输入 s2t（简→繁）或 t2s（繁→简）', value: 's2t' })
  if (answer !== 's2t' && answer !== 't2s') return
  try {
    const res = await api<{ renamed: number; errors: unknown[] }>('/files/convert-names', {
      method: 'POST',
      body: JSON.stringify({ paths, direction: answer }),
    })
    toast.success(`已重命名 ${res.renamed} 项${res.errors.length ? `，${res.errors.length} 项失败` : ''}`)
    await refresh()
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '转换失败')
  }
}

async function convertLyrics() {
  const paths = targetPaths()
  if (!paths.length) return
  const direction = await dialog.prompt({ title: '歌词简繁转换', message: '输入 s2t / t2s；留空只转换编码', value: '' })
  if (direction && direction !== 's2t' && direction !== 't2s') return
  const encoding = await dialog.prompt({ title: '歌词源编码', message: 'auto / utf-8 / gbk / big5', value: 'auto' })
  if (encoding === null) return
  try {
    const res = await api<{ converted: number; errors: unknown[] }>('/files/convert-lyrics', {
      method: 'POST',
      body: JSON.stringify({ paths, direction: direction || undefined, encoding: encoding || 'auto' }),
    })
    toast.success(`已转换 ${res.converted} 个歌词文件${res.errors.length ? `，${res.errors.length} 个失败` : ''}`)
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '歌词转换失败')
  }
}

async function rebuildIndex() {
  indexing.value = true
  try {
    const res = await api<{ added: number; updated: number; removed: number }>('/library/scan', { method: 'POST' })
    toast.success(`索引完成：新增 ${res.added}，更新 ${res.updated}，移除 ${res.removed}`)
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '索引失败')
  } finally {
    indexing.value = false
  }
}

onMounted(loadRoots)
</script>

<template>
  <div class="space-y-6">
    <PageHeader label="Library" title="媒体库" desc="文件管理 · 标签 · 查缺 · 简繁转换">
      <template #actions>
        <button :disabled="indexing" class="k-btn k-btn-ghost" @click="rebuildIndex">
          <Loader2 v-if="indexing" :size="14" class="animate-spin" />
          <RefreshCw v-else :size="14" />
          {{ indexing ? '索引中' : '重建索引' }}
        </button>
      </template>
    </PageHeader>

    <div class="rise k-seg">
      <button class="k-seg-item" :class="tab === 'files' ? 'k-seg-active' : ''" @click="tab = 'files'">文件管理</button>
      <button class="k-seg-item" :class="tab === 'duplicates' ? 'k-seg-active' : ''" @click="tab = 'duplicates'">重复歌曲</button>
    </div>

    <DuplicatesPanel v-if="tab === 'duplicates'" class="rise glass rounded-3xl p-4 sm:p-5" />

    <div v-else class="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside class="glass max-h-[70vh] overflow-auto rounded-2xl p-2">
        <p class="px-2 py-1.5 text-[10px] uppercase tracking-wide text-zinc-600">目录</p>
        <div v-if="rootsLoading" class="space-y-2 p-2"><div v-for="i in 4" :key="i" class="skeleton h-7 rounded-lg" /></div>
        <div v-else>
          <div v-for="node in nodes" :key="node.path" class="flex items-center gap-1 rounded-lg pr-1 text-xs" :style="{ paddingLeft: `${8 + node.depth * 12}px` }">
            <button class="grid h-6 w-5 shrink-0 place-items-center text-zinc-600 hover:text-zinc-300" @click.stop="toggleNode(node)">
              <ChevronDown v-if="node.open" :size="12" />
              <ChevronRight v-else :size="12" />
            </button>
            <button class="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left" :class="current?.path === node.path ? 'text-violet-200' : 'text-zinc-400 hover:text-zinc-200'" @click="clickNode(node)">
              <FolderOpen v-if="node.open" :size="13" class="shrink-0 text-violet-300/70" />
              <Folder v-else :size="13" class="shrink-0 text-zinc-600" />
              <span class="truncate">{{ node.name }}</span>
            </button>
          </div>
        </div>
      </aside>

      <section class="min-w-0">
        <div v-if="!current" class="glass flex flex-col items-center justify-center rounded-2xl py-24 text-center">
          <div class="grid h-16 w-16 place-items-center rounded-3xl border border-white/10 bg-white/[0.03] text-zinc-600"><Folder :size="26" /></div>
          <p class="mt-4 text-sm text-zinc-400">选择左侧目录开始浏览</p>
          <p class="mt-1 text-xs text-zinc-600">进入媒体库不会自动扫描，展开目录后才加载内容</p>
        </div>
        <div v-else class="space-y-3">
          <div class="flex flex-wrap items-center gap-2">
            <button class="grid h-8 w-8 place-items-center rounded-lg border border-white/10 text-zinc-400 hover:text-zinc-200 disabled:opacity-30" :disabled="!current.parent" @click="goParent"><ArrowLeft :size="14" /></button>
            <p class="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-500">{{ current.path }}</p>
            <span class="text-[10px] text-zinc-600">{{ current.dirs.length }} 目录 · {{ current.files.length }} 文件</span>
          </div>

          <div class="flex flex-wrap items-center gap-1.5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-1.5">
            <button class="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] text-zinc-400 hover:bg-white/5 hover:text-zinc-200" @click="mkdir"><Plus :size="12" /> 新建</button>
            <button class="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] text-zinc-400 hover:bg-white/5 hover:text-zinc-200 disabled:opacity-40" :disabled="selectedCount !== 1" @click="renameSelected"><Pencil :size="12" /> 重命名</button>
            <button class="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] text-zinc-400 hover:bg-white/5 hover:text-zinc-200 disabled:opacity-40" :disabled="!selectedCount" @click="copySelected"><Copy :size="12" /> 复制</button>
            <button class="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] text-zinc-400 hover:bg-white/5 hover:text-zinc-200 disabled:opacity-40" :disabled="!selectedCount" @click="moveSelected"><Move :size="12" /> 移动</button>
            <select v-model="fileDeleteMode" class="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] text-zinc-300 outline-none">
              <option value="trash">回收站</option>
              <option value="permanent">彻底删除</option>
            </select>
            <button class="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] text-rose-300/80 hover:bg-rose-500/10 disabled:opacity-40" :disabled="!selectedCount" @click="deleteSelected"><Trash2 :size="12" /> 删除{{ selectedCount ? `(${selectedCount})` : '' }}</button>
            <span class="mx-1 h-4 w-px bg-white/10"></span>
            <button class="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] text-zinc-400 hover:bg-white/5 hover:text-zinc-200 disabled:opacity-40" :disabled="!current" @click="openMissingDialog"><SearchCheck :size="12" /> 查缺</button>
            <button class="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] text-zinc-400 hover:bg-white/5 hover:text-zinc-200" @click="openOrganizeDialog"><Wand2 :size="12" /> 整理</button>
            <button class="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] text-zinc-400 hover:bg-white/5 hover:text-zinc-200" @click="convertNames"><Languages :size="12" /> 简繁</button>
            <button class="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] text-zinc-400 hover:bg-white/5 hover:text-zinc-200" @click="convertLyrics"><FileText :size="12" /> 歌词转码</button>
            <button class="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] text-zinc-400 hover:bg-white/5 hover:text-zinc-200 disabled:opacity-40" :disabled="!selectedAudio" @click="openTagModal(selectedAudio)"><Tags :size="12" /> 标签</button>
            <button class="ml-auto grid h-8 w-8 place-items-center rounded-lg text-zinc-500 hover:bg-white/5 hover:text-zinc-200" title="刷新" @click="refresh"><RefreshCw :size="13" /></button>
          </div>

          <div v-if="listing" class="space-y-2"><div v-for="i in 6" :key="i" class="skeleton h-10 rounded-xl" /></div>
          <div v-else class="glass overflow-hidden rounded-2xl">
            <label class="flex items-center gap-2 border-b border-white/[0.05] px-3 py-2 text-[10px] text-zinc-600">
              <button class="grid h-4 w-4 place-items-center" @click.prevent="toggleSelectAll">
                <CheckSquare v-if="allSelected" :size="14" class="text-violet-300" />
                <Square v-else :size="14" />
              </button>
              全选
            </label>
            <div v-for="dir in current.dirs" :key="dir.path" class="flex items-center gap-2 border-b border-white/[0.04] px-3 py-2 text-xs hover:bg-white/[0.03]">
              <input type="checkbox" class="h-3.5 w-3.5 accent-violet-500" :checked="selectedPaths.has(dir.path)" @change="toggleSelect(dir.path)" />
              <Folder :size="14" class="shrink-0 text-violet-300/70" />
              <button class="min-w-0 flex-1 truncate text-left text-zinc-300" @dblclick="openDir(dir.path)" @click="openDir(dir.path)">{{ dir.name }}</button>
              <span class="text-[10px] text-zinc-600">目录</span>
            </div>
            <div v-for="file in current.files" :key="file.path" class="flex items-center gap-2 border-b border-white/[0.04] px-3 py-2 text-xs last:border-0 hover:bg-white/[0.03]">
              <input type="checkbox" class="h-3.5 w-3.5 accent-violet-500" :checked="selectedPaths.has(file.path)" @change="toggleSelect(file.path)" />
              <FileAudio v-if="file.isAudio" :size="14" class="shrink-0 text-cyan-300/70" />
              <FileText v-else :size="14" class="shrink-0 text-zinc-600" />
              <button class="min-w-0 flex-1 truncate text-left font-mono text-[11px] text-zinc-300" :title="file.name" @dblclick="openTagModal(file)">{{ file.name }}</button>
              <span class="w-10 shrink-0 text-center text-[9px] uppercase text-zinc-600">{{ file.ext }}</span>
              <span class="w-20 shrink-0 text-right text-[10px] tabular-nums text-zinc-600">{{ formatBytes(file.size) }}</span>
            </div>
            <div v-if="!current.dirs.length && !current.files.length" class="px-4 py-10 text-center text-xs text-zinc-600">空目录</div>
          </div>

          <div v-if="missing" class="glass rounded-2xl p-3">
            <div class="flex flex-wrap items-center gap-2">
              <SearchCheck :size="14" class="text-amber-300" />
              <h3 class="text-xs font-semibold text-zinc-200">查缺结果</h3>
              <span class="text-[10px] text-zinc-600">扫描 {{ missing.scanned }} 首 · {{ missing.missing }} 首有缺项</span>
              <button v-if="missing.items.length" :disabled="fixing" class="ml-auto flex items-center gap-1 rounded-lg border border-amber-400/20 bg-amber-400/10 px-2.5 py-1.5 text-[10px] text-amber-200 disabled:opacity-50" @click="fixAllMissing">
                <Loader2 v-if="fixing" :size="11" class="animate-spin" />
                <Sparkles v-else :size="11" />
                {{ fixing ? '刮削中' : '自动刮削补充' }}
              </button>
            </div>
            <div v-if="!missing.items.length" class="mt-2 text-[11px] text-emerald-300">未发现缺项</div>
            <div v-else class="mt-2 max-h-56 space-y-1 overflow-auto">
              <div v-for="item in missing.items" :key="item.path" class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[10px] hover:bg-white/[0.03]">
                <span class="min-w-0 flex-1 truncate font-mono text-zinc-500">{{ item.path }}</span>
                <span v-for="key in item.missing" :key="key" class="rounded bg-amber-400/10 px-1.5 py-0.5 text-amber-200">{{ key }}</span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>

    <div v-if="organizeOpen" class="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" @click.self="organizeOpen = false">
      <div class="glass flex max-h-[90vh] w-full max-w-2xl flex-col rounded-3xl p-5">
        <div class="flex items-center justify-between gap-3">
          <div>
            <h2 class="flex items-center gap-2 text-sm font-semibold"><Wand2 :size="15" class="text-violet-300" /> 自动整理目录</h2>
            <p class="mt-1 text-[10px] text-zinc-600">按命名规则移动/重命名，整理前先预览，不会覆盖已有文件</p>
          </div>
          <button class="grid h-7 w-7 place-items-center rounded-lg text-zinc-500 hover:bg-white/5" @click="organizeOpen = false"><X :size="14" /></button>
        </div>
        <div class="mt-4 space-y-3 overflow-auto pr-1">
          <label class="block">
            <span class="mb-1 block text-[10px] uppercase tracking-wide text-zinc-500">目标根目录（容器内绝对路径）</span>
            <input v-model="organizeRoot" class="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-zinc-200 outline-none focus:border-violet-400/40" />
          </label>
          <label class="block">
            <span class="mb-1 block text-[10px] uppercase tracking-wide text-zinc-500">命名规则</span>
            <input v-model="organizeTemplate" class="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 font-mono text-xs text-zinc-200 outline-none focus:border-violet-400/40" />
            <span class="mt-1 block text-[10px] text-zinc-600">{artist} {artists} {album} {title} {track:02d} {year} {ext}</span>
          </label>
          <p class="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[10px] text-zinc-500">范围：{{ organizePaths.length }} 项 · {{ organizePaths[0] }}</p>
          <div v-if="organizePreview" class="space-y-2">
            <div class="flex flex-wrap gap-3 text-[11px]">
              <span class="text-violet-300">移动 {{ organizePreview.moved }}</span>
              <span class="text-zinc-500">跳过 {{ organizePreview.skipped }}</span>
              <span class="text-amber-300">冲突 {{ organizePreview.conflicts }}</span>
              <span class="text-rose-300">失败 {{ organizePreview.errors }}</span>
            </div>
            <div class="max-h-64 space-y-1 overflow-auto rounded-xl border border-white/[0.05] bg-black/20 p-2">
              <div v-for="item in organizePreview.items" :key="item.from" class="flex gap-2 text-[10px]">
                <span class="w-12 shrink-0" :class="item.status === 'move' ? 'text-emerald-300' : item.status === 'conflict' ? 'text-amber-300' : 'text-zinc-600'">{{ item.status }}</span>
                <span class="min-w-0 flex-1 truncate font-mono text-zinc-600">{{ item.from }}</span>
                <span class="min-w-0 flex-1 truncate font-mono text-zinc-400">{{ item.to }}</span>
              </div>
            </div>
          </div>
        </div>
        <div class="mt-4 flex justify-end gap-2 border-t border-white/[0.06] pt-3">
          <button class="rounded-xl px-3.5 py-2 text-xs text-zinc-400 hover:bg-white/5" @click="organizeOpen = false">取消</button>
          <button :disabled="organizeLoading" class="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2 text-xs text-zinc-200 disabled:opacity-50" @click="previewOrganize">
            <Loader2 v-if="organizeLoading" :size="12" class="animate-spin" /> 预览
          </button>
          <button :disabled="organizeExecuting || !organizePreview || !organizePreview.moved" class="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-cyan-500 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50" @click="executeOrganize">
            <Loader2 v-if="organizeExecuting" :size="12" class="animate-spin" /> 开始整理
          </button>
        </div>
      </div>
    </div>

    <div v-if="missingOpen" class="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" @click.self="missingOpen = false">
      <div class="glass w-full max-w-md rounded-3xl p-5">
        <div class="flex items-center justify-between gap-3">
          <div>
            <h2 class="flex items-center gap-2 text-sm font-semibold"><SearchCheck :size="15" class="text-amber-300" /> 查缺模式</h2>
            <p class="mt-1 break-all text-[10px] text-zinc-600">范围：{{ missingTarget }}</p>
          </div>
          <button class="grid h-7 w-7 place-items-center rounded-lg text-zinc-500 hover:bg-white/5" @click="missingOpen = false"><X :size="14" /></button>
        </div>
        <div class="mt-4 grid grid-cols-2 gap-2">
          <label v-for="item in ([['tags','标签（标题/歌手/专辑/年份）'],['lyric','歌词 .lrc'],['cover','封面 cover.jpg'],['nfo','album.nfo']] as const)" :key="item[0]" class="flex cursor-pointer items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-[11px] text-zinc-300">
            <input v-model="missingChecks[item[0]]" type="checkbox" class="h-3.5 w-3.5 accent-amber-500" />
            {{ item[1] }}
          </label>
        </div>
        <div class="mt-5 flex justify-end gap-2">
          <button class="rounded-xl px-3.5 py-2 text-xs text-zinc-400 hover:bg-white/5" @click="missingOpen = false">取消</button>
          <button :disabled="missingScanning" class="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50" @click="startMissingScan">
            <Loader2 v-if="missingScanning" :size="12" class="animate-spin" />
            <SearchCheck v-else :size="12" />
            {{ missingScanning ? '扫描中…' : '开始扫描' }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="tagOpen" class="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" @click.self="tagOpen = false">
      <div class="glass w-full max-w-md rounded-3xl p-5">
        <div class="flex items-center justify-between">
          <h2 class="flex items-center gap-2 text-sm font-semibold"><Tags :size="15" class="text-violet-300" /> 编辑标签</h2>
          <button class="grid h-7 w-7 place-items-center rounded-lg text-zinc-500 hover:bg-white/5" @click="tagOpen = false"><X :size="14" /></button>
        </div>
        <div v-if="tagLoading" class="mt-4 space-y-2"><div v-for="i in 4" :key="i" class="skeleton h-9 rounded-xl" /></div>
        <form v-else class="mt-4 space-y-2.5" @submit.prevent="saveTags">
          <label v-for="field in (['title','artist','album','year','track'] as const)" :key="field" class="block">
            <span class="mb-1 block text-[10px] uppercase tracking-wide text-zinc-500">{{ field }}</span>
            <input v-model="tagForm[field]" class="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-zinc-200 outline-none focus:border-violet-400/40" />
          </label>
          <p class="text-[10px] text-zinc-600">封面：{{ tagInfo?.coverPath || (tagInfo?.hasEmbeddedCover ? '已内嵌' : '缺失') }} · 歌词：{{ tagInfo?.lyricPath ? '有' : '缺失' }}</p>
          <div class="flex justify-end gap-2 pt-2">
            <button type="button" class="rounded-xl px-3 py-2 text-xs text-zinc-400 hover:bg-white/5" @click="tagOpen = false">取消</button>
            <button type="submit" :disabled="tagSaving" class="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-cyan-500 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">
              <Loader2 v-if="tagSaving" :size="12" class="animate-spin" /> 保存
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
