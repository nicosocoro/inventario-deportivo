<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useServices } from '../../shared/container'
import { toast } from '../../shared/toast'
import { errorMessage } from '../../shared/errors'
import { can, refreshSession } from './session'

const services = useServices()
const minutes = ref<number | null>(null)
const loading = ref(true)
const busy = ref(false)
const error = ref<string | null>(null)

onMounted(async () => {
  try {
    minutes.value = (await services.users.getSettings()).void_own_window_minutes
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    loading.value = false
  }
})

async function save() {
  error.value = null
  const v = minutes.value
  if (v === null || !Number.isInteger(v) || v < 0 || v > 1440) {
    error.value = 'Tiene que ser un número entero de minutos entre 0 y 1440'
    return
  }
  busy.value = true
  try {
    await services.users.setSetting('void_own_window_minutes', v)
    await refreshSession(services)
    toast('Ajuste guardado')
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <main class="page">
    <h1>Ajustes</h1>
    <p v-if="loading" aria-busy="true">Cargando…</p>
    <form v-else @submit.prevent="save">
      <label for="win">
        Límite para que un vendedor anule su propia venta (minutos)
        <input id="win" v-model.number="minutes" type="number" inputmode="numeric" min="0" max="1440" step="1" :disabled="!can('settings.manage')" />
        <small>Siempre dentro del mismo día. <strong>0</strong> = sin límite de minutos (solo el mismo día). Fuera del límite, anula un admin.</small>
      </label>
      <p v-if="error" class="err-text">{{ error }}</p>
      <button v-if="can('settings.manage')" class="big" :aria-busy="busy" :disabled="busy">Guardar</button>
      <p v-else class="muted">No tenés permiso para editar ajustes.</p>
    </form>
    <p class="muted">Los teléfonos toman el cambio la próxima vez que se conectan.</p>
  </main>
</template>
