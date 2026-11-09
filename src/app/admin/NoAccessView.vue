<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useServices } from '../../shared/container'
import { session } from '../../users/web/session'

const services = useServices()
const router = useRouter()
async function logout() {
  await services.auth.signOut()
  session.user = null
  await router.replace('/login')
}
</script>

<template>
  <main class="login">
    <h1>No tenés permisos</h1>
    <p>Tu usuario no puede entrar al panel admin. Para vender, usá el sitio de ventas.</p>
    <button class="big" @click="logout">Cerrar sesión</button>
  </main>
</template>
