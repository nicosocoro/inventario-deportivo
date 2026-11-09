<script setup lang="ts">
import { ref, watch } from 'vue'
import { parseMoney } from './money'

// Campo de pesos enteros con teclado numérico.
const props = defineProps<{ modelValue: number | null; label: string; id: string; autofocus?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [number | null] }>()
const text = ref(props.modelValue === null ? '' : String(props.modelValue))

watch(
  () => props.modelValue,
  (v) => {
    if (parseMoney(text.value) !== v) text.value = v === null ? '' : String(v)
  },
)

function onInput(e: Event) {
  text.value = (e.target as HTMLInputElement).value
  emit('update:modelValue', text.value.trim() === '' ? null : parseMoney(text.value))
}
</script>

<template>
  <label :for="id">
    {{ label }}
    <input :id="id" :value="text" inputmode="numeric" autocomplete="off" placeholder="$" :autofocus="autofocus" @input="onInput" />
  </label>
</template>
