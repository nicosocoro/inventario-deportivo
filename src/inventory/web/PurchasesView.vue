<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useServices } from '../../shared/container'
import BottomSheet from '../../shared/BottomSheet.vue'
import MoneyInput from '../../shared/MoneyInput.vue'
import { toast } from '../../shared/toast'
import { errorMessage } from '../../shared/errors'
import { formatMoney } from '../../shared/money'
import { formatTime, localDay } from '../../shared/dates'
import { newId } from '../../shared/ids'
import { online } from '../../shared/online'
import { catalog, refreshCatalog } from './catalog'
import { purchaseProducts, type Product, type StockMovement } from '../domain/product'
import { can, session } from '../../users/web/session'

// Ingreso de compras: cantidad y TOTAL gastado (alimenta los egresos del balance). Requiere señal.
const services = useServices()
const search = ref('')
const selected = ref<Product | null>(null)
const qty = ref<number | null>(1)
const cost = ref<number | null>(null)
const note = ref('')
const opId = ref(newId())
const busy = ref(false)
const error = ref<string | null>(null)
const today = ref<StockMovement[]>([])

const groups = computed(() => {
  const q = search.value.trim().toLowerCase()
  const g = purchaseProducts(catalog.products)
  const f = (l: Product[]) => (q ? l.filter((p) => p.name.toLowerCase().includes(q)) : l)
  return { forSale: f(g.forSale), supplies: f(g.supplies), misc: f(g.misc) }
})

async function loadToday() {
  if (!online.value) return
  try {
    const d = localDay(new Date())
    const list = await services.products.listMovements({ from: d, to: d, types: ['entrada'], limit: 50 })
    today.value = list.filter((m) => m.createdBy === session.user?.id || can('history.view'))
  } catch {
    /* sin datos */
  }
}
onMounted(async () => {
  await refreshCatalog(services)
  await loadToday()
})

function pick(p: Product) {
  selected.value = p
  qty.value = 1
  cost.value = null
  note.value = ''
  error.value = null
  opId.value = newId()
}

async function save() {
  const p = selected.value!
  error.value = null
  if (!qty.value || qty.value < 1) return void (error.value = 'Cantidad inválida')
  if (cost.value === null) return void (error.value = 'Cargá cuánto se gastó en total (puede ser 0)')
  if (p.requiresNote && !note.value.trim()) return void (error.value = 'Escribí el detalle del gasto')
  busy.value = true
  try {
    await services.products.addStock(opId.value, p.id, qty.value, cost.value, note.value.trim() || null)
    toast(`Compra cargada: ${qty.value} × ${p.name}`)
    selected.value = null
    await Promise.all([refreshCatalog(services), loadToday()])
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}

// Anular una compra cargada mal (stock.adjust)
const voiding = ref<StockMovement | null>(null)
const voidReason = ref('')
async function confirmVoid() {
  if (!voidReason.value.trim()) return
  busy.value = true
  try {
    await services.products.voidEntry(voiding.value!.id, voidReason.value.trim())
    toast('Compra anulada')
    voiding.value = null
    await Promise.all([refreshCatalog(services), loadToday()])
  } catch (e) {
    toast(errorMessage(e), 'error')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <main class="page">
    <h1>Cargar compra</h1>
    <div v-if="!online" class="notice warn">Para cargar compras necesitás señal.</div>
    <input v-model="search" type="search" placeholder="Buscar producto…" aria-label="Buscar producto" />

    <template v-for="[title, list] in ([['A la venta', groups.forSale], ['Insumos', groups.supplies], ['Otros gastos', groups.misc]] as const)" :key="title">
      <h2 v-if="list.length">{{ title }}</h2>
      <ul class="list">
        <li v-for="p in list" :key="p.id">
          <button class="outline big" style="width: 100%; text-align: left; margin: 0" :disabled="!online" @click="pick(p)">
            {{ p.name }}
            <span v-if="!p.requiresNote" class="muted" style="float: right">stock {{ p.stock }}</span>
            <span v-else class="muted" style="display: block">Usar solo si no existe un producto</span>
          </button>
        </li>
      </ul>
    </template>

    <template v-if="today.length">
      <h2>Compras de hoy</h2>
      <ul class="list">
        <li v-for="m in today" :key="m.id">
          <div class="line">
            <span>{{ formatTime(m.createdAt) }} · {{ m.quantity }} × {{ m.productName }}</span>
            <strong>{{ formatMoney(m.totalCost ?? 0) }}</strong>
          </div>
          <div v-if="m.note" class="muted">{{ m.note }}</div>
          <span v-if="m.reversed" class="chip err">Anulada</span>
          <button
            v-else-if="can('stock.adjust')"
            class="secondary outline"
            style="width: auto; margin: 0.3rem 0 0; padding: 0.25rem 0.8rem"
            @click="((voiding = m), (voidReason = ''))"
          >
            Anular
          </button>
        </li>
      </ul>
    </template>

    <BottomSheet :open="!!selected" :title="selected?.name ?? ''" @close="selected = null">
      <form v-if="selected" @submit.prevent="save">
        <label for="q">Cantidad (unidades)<input id="q" v-model.number="qty" type="number" inputmode="numeric" min="1" step="1" /></label>
        <MoneyInput id="c" v-model="cost" label="Total gastado" />
        <label for="n">
          {{ selected.requiresNote ? 'Detalle (obligatorio)' : 'Nota (opcional)' }}
          <input id="n" v-model="note" :placeholder="selected.requiresNote ? 'Ej: detergente y trapos' : ''" />
        </label>
        <p v-if="error" class="err-text">{{ error }}</p>
        <button class="big" :aria-busy="busy" :disabled="busy">Guardar compra</button>
      </form>
    </BottomSheet>

    <BottomSheet :open="!!voiding" title="Anular compra" @close="voiding = null">
      <form v-if="voiding" @submit.prevent="confirmVoid">
        <p>{{ voiding.quantity }} × {{ voiding.productName }} · {{ formatMoney(voiding.totalCost ?? 0) }}</p>
        <label for="vr">Motivo<input id="vr" v-model="voidReason" required /></label>
        <button class="big secondary" :aria-busy="busy" :disabled="busy || !voidReason.trim()">Anular compra</button>
      </form>
    </BottomSheet>
  </main>
</template>
