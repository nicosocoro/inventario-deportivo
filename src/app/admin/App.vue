<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import BottomNav from '../../shared/BottomNav.vue'
import ToastHost from '../../shared/ToastHost.vue'
import { online } from '../../shared/online'
import { can, session } from '../../users/web/session'

const router = useRouter()
watch(
  () => session.user?.id,
  (id) => {
    if (!id) void router.replace('/login')
  },
)

const nav = computed(() =>
  [
    can('balance.view') && { to: '/balance', label: 'Balance', icon: '📊' },
    { to: '/productos', label: 'Productos', icon: '🏷️' },
    can('history.view') && { to: '/historial', label: 'Historial', icon: '🕘' },
    { to: '/mas', label: 'Más', icon: '☰' },
  ].filter((x): x is { to: string; label: string; icon: string } => Boolean(x)),
)
</script>

<template>
  <header v-if="session.user && can('admin.access')" class="app-header">
    <div style="min-width: 0">
      <div class="brand">Admin · Cantina CADB</div>
      <div class="who">{{ session.user.displayName ?? session.user.username }} ({{ session.user.role }})</div>
    </div>
    <span v-if="!online" class="conn off">Sin señal</span>
  </header>
  <div v-if="!online && session.user" class="notice warn" style="margin: 0.5rem 0.9rem">El panel admin necesita conexión.</div>
  <RouterView />
  <BottomNav v-if="session.user && can('admin.access')" :items="nav" />
  <ToastHost />
</template>
