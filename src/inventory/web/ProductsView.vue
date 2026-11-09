<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useServices } from '../../shared/container'
import BottomSheet from '../../shared/BottomSheet.vue'
import MoneyInput from '../../shared/MoneyInput.vue'
import { toast } from '../../shared/toast'
import { errorMessage } from '../../shared/errors'
import { formatMoney } from '../../shared/money'
import { formatDateTime } from '../../shared/dates'
import { catalog, refreshCatalog } from './catalog'
import { byOrder, isSupply, stockStatus, validateProduct, type PriceChange, type Product, type ProductDraft } from '../domain/product'
import { can } from '../../users/web/session'

const services = useServices()
const search = ref('')
const showInactive = ref(false)
const list = computed(() => {
  const q = search.value.trim().toLowerCase()
  return [...catalog.products]
    .filter((p) => (showInactive.value || p.active) && (!q || p.name.toLowerCase().includes(q)))
    .sort(byOrder)
})
onMounted(() => refreshCatalog(services))

const editing = ref<Product | 'new' | null>(null)
const draft = ref<ProductDraft>(emptyDraft())
const price = ref<number | null>(null)
const history = ref<PriceChange[]>([])
const error = ref<string | null>(null)
const busy = ref(false)

function emptyDraft(): ProductDraft {
  return { name: '', price: 0, forSale: true, requiresNote: false, minStock: null, sortOrder: 0, active: true }
}

async function open(p: Product | 'new') {
  editing.value = p
  error.value = null
  history.value = []
  if (p === 'new') {
    draft.value = emptyDraft()
    price.value = null
  } else {
    draft.value = { name: p.name, price: p.price, forSale: p.forSale, requiresNote: p.requiresNote, minStock: p.minStock, sortOrder: p.sortOrder, active: p.active }
    price.value = p.price
    try {
      history.value = await services.products.priceHistory(p.id)
    } catch {
      /* opcional */
    }
  }
}

async function save() {
  error.value = null
  const d = { ...draft.value, price: price.value ?? 0, name: draft.value.name.trim() }
  const invalid = validateProduct(d)
  if (invalid) return void (error.value = invalid)
  busy.value = true
  try {
    if (editing.value === 'new') {
      await services.products.create(d)
      toast(`Producto ${d.name} creado`)
    } else {
      const p = editing.value!
      await services.products.update(p.id, d)
      if (can('prices.manage') && d.price !== p.price) await services.products.setPrice(p.id, d.price)
      toast('Guardado')
    }
    editing.value = null
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
    <div class="row" style="justify-content: space-between">
      <h1>Productos</h1>
      <button v-if="can('products.manage')" style="width: auto" @click="open('new')">+ Nuevo</button>
    </div>
    <input v-model="search" type="search" placeholder="Buscar…" aria-label="Buscar producto" />
    <label class="row"><input v-model="showInactive" type="checkbox" role="switch" /> Mostrar desactivados</label>
    <ul class="list">
      <li v-for="p in list" :key="p.id" @click="open(p)" style="cursor: pointer">
        <div class="line">
          <span>
            {{ p.name }}
            <span v-if="isSupply(p)" class="chip">Insumo</span>
            <span v-if="p.requiresNote" class="chip">Gasto con detalle</span>
            <span v-if="!p.active" class="chip err">Desactivado</span>
          </span>
          <strong>{{ p.forSale ? formatMoney(p.price) : '' }}</strong>
        </div>
        <div v-if="!p.requiresNote" class="muted">
          Stock {{ p.stock }}
          <span v-if="stockStatus(p) !== 'ok'" class="chip" :class="stockStatus(p) === 'negative' ? 'err' : 'warn'">
            {{ stockStatus(p) === 'negative' ? 'negativo' : 'bajo' }}
          </span>
        </div>
      </li>
    </ul>

    <BottomSheet :open="editing !== null" :title="editing === 'new' ? 'Nuevo producto' : 'Editar producto'" @close="editing = null">
      <form @submit.prevent="save">
        <fieldset :disabled="!can('products.manage')">
          <label for="pn">Nombre<input id="pn" v-model="draft.name" maxlength="60" required /></label>
          <label class="row"><input v-model="draft.forSale" type="checkbox" role="switch" /> Se vende en caja</label>
          <small v-if="!draft.forSale" class="muted">Insumo: no aparece en la caja (ej: hielo, carbón). Se compra y se registra cuándo se usa.</small>
          <label for="pm">Stock mínimo (aviso)<input id="pm" v-model.number="draft.minStock" type="number" inputmode="numeric" min="0" /></label>
          <label for="po">Orden en la caja (menor = primero)<input id="po" v-model.number="draft.sortOrder" type="number" inputmode="numeric" /></label>
          <label class="row"><input v-model="draft.active" type="checkbox" role="switch" /> Activo</label>
        </fieldset>
        <fieldset v-if="draft.forSale" :disabled="editing !== 'new' && !can('prices.manage')">
          <MoneyInput id="pp" v-model="price" label="Precio de venta" />
        </fieldset>
        <p v-if="error" class="err-text">{{ error }}</p>
        <button v-if="can('products.manage') || can('prices.manage')" class="big" :aria-busy="busy" :disabled="busy">Guardar</button>
      </form>
      <template v-if="history.length">
        <h2>Historial de precios</h2>
        <ul class="list">
          <li v-for="h in history" :key="h.validFrom" class="line">
            <span class="muted">desde {{ formatDateTime(h.validFrom) }}</span>
            <strong>{{ formatMoney(h.price) }}</strong>
          </li>
        </ul>
      </template>
    </BottomSheet>
  </main>
</template>
