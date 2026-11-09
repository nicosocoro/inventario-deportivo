<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { isIos, isStandalone } from './device'

// Aviso fijo cuando la app se abre en una pestaña del navegador en vez de instalada.
// En iOS la app instalada NO comparte sesión ni datos con Safari: hay que entrar desde el ícono.
const show = ref(false)
const ios = isIos()
const deferred = ref<{ prompt(): Promise<void> } | null>(null)

onMounted(() => {
  show.value = !isStandalone()
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred.value = e as unknown as { prompt(): Promise<void> }
  })
})

async function install() {
  await deferred.value?.prompt()
}
</script>

<template>
  <div v-if="show" class="notice warn install-hint">
    <strong>Instalá la app para usarla sin señal.</strong>
    <ol v-if="ios">
      <li>Tocá <strong>Compartir</strong> (el cuadrado con la flecha ↑).</li>
      <li>Elegí <strong>Agregar a inicio</strong>.</li>
      <li>Abrí la app desde el ícono <strong>Cantina</strong> e iniciá sesión ahí.</li>
    </ol>
    <template v-else>
      <div v-if="deferred" style="margin-top: 0.4rem">
        <button class="big" type="button" @click="install">Instalar app</button>
      </div>
      <div v-else>En el menú del navegador (⋮) elegí <strong>Instalar app</strong> o <strong>Agregar a pantalla principal</strong>.</div>
    </template>
  </div>
</template>
