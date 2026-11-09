<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue'

const props = defineProps<{ open: boolean; title: string }>()
const emit = defineEmits<{ close: [] }>()

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}
watch(
  () => props.open,
  (o) => {
    document.body.style.overflow = o ? 'hidden' : ''
    if (o) window.addEventListener('keydown', onKey)
    else window.removeEventListener('keydown', onKey)
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  document.body.style.overflow = ''
  window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="sheet-backdrop" @click.self="emit('close')">
      <section class="sheet" role="dialog" aria-modal="true" :aria-label="title">
        <div class="sheet-head">
          <h3>{{ title }}</h3>
          <button class="secondary outline" type="button" @click="emit('close')">Cerrar</button>
        </div>
        <slot />
      </section>
    </div>
  </Teleport>
</template>
