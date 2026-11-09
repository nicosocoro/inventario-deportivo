<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useServices } from '../../shared/container'
import { can, session } from '../../users/web/session'

const services = useServices()
const router = useRouter()

async function logout() {
  await services.auth.signOut()
  session.user = null
  await router.replace('/login')
}
</script>

<template>
  <main class="page">
    <h1>Más</h1>
    <ul class="menu">
      <li v-if="can('history.view')"><RouterLink to="/ventas">Ventas (anular) <span>›</span></RouterLink></li>
      <li v-if="can('users.manage')"><RouterLink to="/usuarios">Usuarios <span>›</span></RouterLink></li>
      <li><RouterLink to="/permisos">Permisos por rol <span>›</span></RouterLink></li>
      <li><RouterLink to="/ajustes">Ajustes (límite de anulación) <span>›</span></RouterLink></li>
      <li><RouterLink to="/clave">Cambiar mi contraseña <span>›</span></RouterLink></li>
      <li><button type="button" @click="logout">Cerrar sesión <span>⎋</span></button></li>
    </ul>
    <p class="muted">Sesión: @{{ session.user?.username }} ({{ session.user?.role }})</p>
  </main>
</template>
