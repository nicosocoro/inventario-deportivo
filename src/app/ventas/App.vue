<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useRegisterSW } from 'virtual:pwa-register/vue'
import BottomNav from '../../shared/BottomNav.vue'
import ToastHost from '../../shared/ToastHost.vue'
import InstallHint from '../../shared/InstallHint.vue'
import { useServices } from '../../shared/container'
import { online } from '../../shared/online'
import { requestPersistentStorage } from '../../shared/device'
import { refreshSession, session } from '../../users/web/session'
import { refreshCatalog } from '../../inventory/web/catalog'
import { startAutoSync, syncNow, syncState } from '../../sales/web/sync'

const services = useServices()
const router = useRouter()

// Actualizaciones de la app: solo se ofrecen si no hay ventas pendientes.
const { needRefresh, updateServiceWorker } = useRegisterSW({ immediate: true })
const showUpdate = computed(() => needRefresh.value && syncState.pending === 0)

let stopSync: (() => void) | null = null
function start() {
  stopSync?.()
  stopSync = startAutoSync(services)
  void refreshCatalog(services)
  void requestPersistentStorage()
}
onMounted(() => {
  if (session.user) start()
})
watch(
  () => session.user?.id,
  (id, prev) => {
    if (id && id !== prev) start()
    if (!id) {
      stopSync?.()
      stopSync = null
      void router.replace('/login')
    }
  },
)
watch(online, (on) => {
  if (on && session.user) void refreshSession(services)
})
onBeforeUnmount(() => stopSync?.())

const nav = computed(() => [
  { to: '/caja', label: 'Caja', icon: '🧾' },
  { to: '/compras', label: 'Compras', icon: '📦' },
  { to: '/mis-ventas', label: 'Mis ventas', icon: '📋', badge: syncState.pending + syncState.rejected || undefined },
  { to: '/mas', label: 'Más', icon: '☰' },
])

async function relogin() {
  const username = session.user?.username
  await services.auth.signOut()
  session.user = null
  syncState.needsLogin = false
  await router.replace({ path: '/login', query: username ? { u: username } : {} })
}
</script>

<template>
  <InstallHint />
  <header v-if="session.user" class="app-header">
    <div style="min-width: 0">
      <div class="brand">Cantina CADB</div>
      <div class="who">{{ session.user.displayName ?? session.user.username }}</div>
    </div>
    <button
      type="button"
      class="conn"
      :class="online ? 'on' : 'off'"
      :aria-busy="syncState.syncing"
      title="Sincronizar ahora"
      @click="syncNow({ manual: true })"
    >
      <template v-if="!online">Sin señal<span v-if="syncState.pending"> · {{ syncState.pending }} pendientes</span></template>
      <template v-else-if="syncState.syncing">Sincronizando…</template>
      <template v-else-if="syncState.pending">{{ syncState.pending }} pendientes</template>
      <template v-else>En línea</template>
    </button>
  </header>
  <div v-if="syncState.needsLogin" class="notice err" style="margin: 0.5rem 0.9rem">
    No pudimos validar tu sesión. Las ventas siguen guardadas en el teléfono.
    <button class="big" style="margin-top: 0.4rem" @click="relogin">Volver a entrar (con el mismo usuario)</button>
  </div>
  <div v-if="showUpdate" class="notice" style="margin: 0.5rem 0.9rem">
    Hay una versión nueva de la app.
    <button style="margin-top: 0.4rem" @click="updateServiceWorker()">Actualizar</button>
  </div>
  <RouterView />
  <BottomNav v-if="session.user" :items="nav" />
  <ToastHost />
</template>
