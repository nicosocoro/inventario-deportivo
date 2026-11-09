<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useServices } from '../../shared/container'
import { toast } from '../../shared/toast'
import { session } from '../../users/web/session'
import { syncState } from '../../sales/web/sync'

const services = useServices()
const router = useRouter()

async function logout() {
  const pending = await services.outbox.pendingFor(session.user!.id)
  if (pending.length) {
    toast(`Tenés ${pending.length} ventas sin sincronizar. Conectate antes de salir.`, 'error', 6000)
    return
  }
  await services.auth.signOut()
  session.user = null
  await router.replace('/login')
}
</script>

<template>
  <main class="page">
    <h1>Más</h1>
    <ul class="menu">
      <li><RouterLink to="/mas/stock">Stock e insumos <span>›</span></RouterLink></li>
      <li>
        <RouterLink to="/mas/estado">
          Estado del teléfono
          <span><span v-if="syncState.pending" class="badge">{{ syncState.pending }}</span> ›</span>
        </RouterLink>
      </li>
      <li><RouterLink to="/mas/clave">Cambiar mi contraseña <span>›</span></RouterLink></li>
      <li><button type="button" @click="logout">Cerrar sesión <span>⎋</span></button></li>
    </ul>
    <p class="muted">Sesión: @{{ session.user?.username }} ({{ session.user?.role }})</p>
  </main>
</template>
