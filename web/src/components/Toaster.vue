<script setup lang="ts">
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-vue-next'
import { useToast } from '@/stores/toast'

const toast = useToast()
const icons = { success: CheckCircle2, error: AlertCircle, info: Info }
const tones = {
  success: 'text-emerald-300',
  error: 'text-rose-300',
  info: 'text-sky-300',
}
</script>

<template>
  <div class="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex flex-col items-center gap-2 px-4 lg:bottom-6 lg:right-6 lg:left-auto lg:items-end">
    <TransitionGroup name="toast">
      <div
        v-for="item in toast.items"
        :key="item.id"
        class="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-2xl border border-white/10 bg-[#12141b]/95 px-4 py-3 shadow-2xl shadow-black/50 backdrop-blur-xl"
      >
        <component :is="icons[item.kind]" :size="18" :class="['mt-0.5 shrink-0', tones[item.kind]]" />
        <p class="flex-1 text-sm leading-relaxed text-zinc-200">{{ item.text }}</p>
        <button class="text-zinc-500 transition hover:text-zinc-200" @click="toast.remove(item.id)">
          <X :size="15" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: all 0.25s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(8px) scale(0.98);
}
</style>
