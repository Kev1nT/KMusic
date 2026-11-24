<script setup lang="ts">
defineProps<{ modelValue: boolean; label?: string; desc?: string }>()
const emit = defineEmits<{ 'update:modelValue': [boolean] }>()
</script>

<template>
  <label class="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-3 transition hover:border-white/[0.12]">
    <span class="min-w-0">
      <span class="block text-xs text-zinc-200">{{ label }}</span>
      <span v-if="desc" class="mt-0.5 block text-[10px] leading-relaxed text-zinc-500">{{ desc }}</span>
    </span>
    <button
      type="button"
      role="switch"
      :aria-checked="modelValue"
      class="relative h-6 w-11 shrink-0 rounded-full transition"
      :class="modelValue ? 'bg-gradient-to-r from-violet-500 to-cyan-400' : 'bg-white/10'"
      @click.prevent="emit('update:modelValue', !modelValue)"
    >
      <span class="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all" :class="modelValue ? 'left-[22px]' : 'left-0.5'" />
    </button>
  </label>
</template>
