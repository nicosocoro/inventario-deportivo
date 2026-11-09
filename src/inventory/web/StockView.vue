<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useServices } from '../../shared/container'
import BottomSheet from '../../shared/BottomSheet.vue'
import { toast } from '../../shared/toast'
import { errorMessage } from '../../shared/errors'
import { formatDateTime } from '../../shared/dates'
import { newId } from '../../shared/ids'
import { online } from '../../shared/online'
import { catalog, refreshCatalog } from './catalog'
import { isSupply, stockProducts, stockStatus, type Product } from '../domain/product'
import { can } from '../../users/web/session'

// Stock de productos e insumos: "Usé" (consumo) y "Ajustar" (corrección con motivo). Requiere señal.
const services = useServices()
const list = computed(() => stockProducts(catalog.products))
const busy = ref(false)
const error = ref<string | null>(null)

onMounted(() => refreshCatalog(services))

const mode = ref<'consume' | 'adjust' | null>(null)
const target = ref<Product | null>(null)
const qty = ref<number | null>(1)
const sign = ref<1 | -1>(-1)
const note = ref('')
const opId = ref(newId())

function open(m: 'consume' | 'adjust', p: Product) {
  mode.value = m
  target.value = p
  qty.value = 1
  sign.value = -1
  note.value = ''
  error.value = null
  opId.value = newId()
}

async function save() {
  const p = target.value!
  error.value = null
  busy.value = true
  try {
    if (mode.value === 'consume') {
      if (!qty.value || qty.value < 1) throw new Error('Cantidad inválida')
      await services.products.consumeStock(opId.value, p.id, qty.value, note.value.trim() || null)
      toast(`Registrado: usaste ${qty.value} de ${p.name}`)
    } else {
      if (!qty.value || qty.value < 1) throw new Error('Cantidad inválida')
      if (!note.value.trim()) throw new Error('El motivo es obligatorio')
      await services.products.adjustStock(opId.value, p.id, sign.value * qty.value, note.value.trim())
      toast('Stock ajustado')
    }
    mode.value = null
    await refreshCatalog(services)
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <main class="page">
    <h1>Stock</h1>
    <div v-if="!online" class="notice warn">Sin señal: el stock puede no estar actualizado y no se puede modificar.</div>
    <p v-if="catalog.savedAt" class="muted">Actualizado {{ formatDateTime(catalog.savedAt) }}</p>
    <ul class="list">
      <li v-for="p in list" :key="p.id">
        <div class="line">
          <span>
            {{ p.name }}
            <span v-if="isSupply(p)" class="chip">Insumo</span>
            <span v-if="stockStatus(p) === 'negative'" class="chip err">Negativo</span>
            <span v-else-if="stockStatus(p) === 'low'" class="chip warn">Bajo</span>
          </span>
          <strong :style="{ color: p.stock < 0 ? 'var(--c-err)' : undefined }">{{ p.stock }}</strong>
        </div>
        <div v-if="p.minStock !== null" class="muted">Mínimo {{ p.minStock }}</div>
        <div class="actions" style="margin-top: 0.4rem">
          <button v-if="isSupply(p) && can('stock.consume')" :disabled="!online" @click="open('consume', p)">Usé</button>
          <button v-if="can('stock.adjust')" class="outline" :disabled="!online" @click="open('adjust', p)">Ajustar</button>
        </div>
      </li>
    </ul>

    <BottomSheet :open="mode !== null" :title="mode === 'consume' ? `Usé ${target?.name}` : `Ajustar ${target?.name}`" @close="mode = null">
      <form v-if="target" @submit.prevent="save">
        <template v-if="mode === 'consume'">
          <label for="cq">¿Cuántas?<input id="cq" v-model.number="qty" type="number" inputmode="numeric" min="1" step="1" /></label>
          <label for="cn">Nota (opcional)<input id="cn" v-model="note" /></label>
        </template>
        <template v-else>
          <p class="muted">Stock actual: {{ target.stock }}</p>
          <div class="seg">
            <button type="button" :aria-pressed="sign === -1" @click="sign = -1">Restar</button>
            <button type="button" :aria-pressed="sign === 1" @click="sign = 1">Sumar</button>
          </div>
          <label for="ad">Cantidad<input id="ad" v-model.number="qty" type="number" inputmode="numeric" min="1" step="1" /></label>
          <label for="an">Motivo (obligatorio)<input id="an" v-model="note" placeholder="Ej: se rompieron, conteo" required /></label>
          <p v-if="qty && target.stock + sign * qty < 0" class="notice warn">El stock va a quedar en {{ target.stock + sign * qty }} (negativo).</p>
        </template>
        <p v-if="error" class="err-text">{{ error }}</p>
        <button class="big" :aria-busy="busy" :disabled="busy">Guardar</button>
      </form>
    </BottomSheet>
  </main>
</template>
