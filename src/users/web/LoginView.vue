<script setup lang="ts">
import { ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useServices } from '../../shared/container'
import { session } from './session'
import { can as canDo, type Permission } from '../domain/permissions'
import { errorMessage } from '../../shared/errors'
import { isConfigured } from '../../shared/supabase-client'
import { online } from '../../shared/online'

const props = defineProps<{ title: string; requires?: Permission; home: string }>()
const services = useServices()
const router = useRouter()
const route = useRoute()

const username = ref(typeof route.query.u === 'string' ? route.query.u : '')
const password = ref('')
const busy = ref(false)
const error = ref<string | null>(null)

async function submit() {
  error.value = null
  busy.value = true
  try {
    const user = await services.auth.signIn(username.value, password.value)
    if (props.requires && !canDo(user, props.requires)) {
      await services.auth.signOut()
      throw new Error('No tenés permisos para entrar acá')
    }
    session.user = user
    const to = typeof route.query.r === 'string' ? route.query.r : props.home
    await router.replace(to)
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <main class="login">
    <h1>{{ title }}</h1>
    <p class="muted" style="text-align: center">Club Atlético Deportivo Barreal</p>
    <div v-if="!isConfigured" class="notice err">Falta configurar Supabase (.env). Ver README.</div>
    <div v-if="!online" class="notice warn">Para iniciar sesión necesitás señal.</div>
    <form @submit.prevent="submit">
      <label for="u">
        Usuario
        <input id="u" v-model="username" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required />
      </label>
      <label for="p">
        Contraseña
        <input id="p" v-model="password" type="password" autocomplete="current-password" required />
      </label>
      <p v-if="error" class="err-text" role="alert">{{ error }}</p>
      <button class="big" type="submit" :aria-busy="busy" :disabled="busy">Entrar</button>
    </form>
    <p class="muted" style="text-align: center">Los usuarios los crea un admin. Si no tenés uno, pedíselo.</p>
  </main>
</template>
