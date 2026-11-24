<script setup lang="ts">
defineProps<{ label?: string; title: string; desc?: string }>()
</script>

<template>
  <header class="rise mb-6 flex flex-wrap items-end justify-between gap-4">
    <div class="min-w-0">
      <p v-if="label" class="k-label">{{ label }}</p>
      <h1 class="k-page-title mt-1">{{ title }}</h1>
      <p v-if="desc" class="mt-1.5 text-sm text-zinc-500">{{ desc }}</p>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <slot name="actions" />
    </div>
  </header>
</template>
