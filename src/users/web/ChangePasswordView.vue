<script setup lang="ts">
import { ref } from 'vue'
import { useServices } from '../../shared/container'
import { toast } from '../../shared/toast'
import { errorMessage } from '../../shared/errors'

const services = useServices()
const pass = ref('')
const pass2 = ref('')
const busy = ref(false)
const error = ref<string | null>(null)

async function submit() {
  error.value = null
  if (pass.value !== pass2.value) {
    error.value = 'Las contraseñas no coinciden'
    return
  }
  busy.value = true
  try {
    await services.auth.changeOwnPassword(pass.value)
    pass.value = pass2.value = ''
    toast('Contraseña cambiada')
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <main class="page">
    <h1>Cambiar mi contraseña</h1>
    <form @submit.prevent="submit">
      <label for="np">Nueva contraseña (mínimo 8)<input id="np" v-model="pass" type="password" autocomplete="new-password" minlength="8" required /></label>
      <label for="np2">Repetila<input id="np2" v-model="pass2" type="password" autocomplete="new-password" minlength="8" required /></label>
      <p v-if="error" class="err-text">{{ error }}</p>
      <button class="big" :aria-busy="busy" :disabled="busy">Guardar</button>
    </form>
  </main>
</template>
