<script setup lang="ts">
defineProps<{ items: { to: string; label: string; icon: string; badge?: number }[] }>()
</script>

<template>
  <nav class="bottom-nav" aria-label="Secciones">
    <RouterLink v-for="i in items" :key="i.to" :to="i.to">
      <span class="ico" aria-hidden="true">{{ i.icon }}</span>
      <span>{{ i.label }}</span>
      <span v-if="i.badge" class="badge">{{ i.badge }}</span>
    </RouterLink>
  </nav>
</template>
