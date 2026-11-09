<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useServices } from '../../shared/container'
import { errorMessage } from '../../shared/errors'
import { formatDateTime } from '../../shared/dates'
import { formatMoney } from '../../shared/money'
import { flagLabel } from '../domain/sale'
import type { AuditEntry } from '../../users/domain/ports'

// Historial (audit_log): quién hizo qué, cuándo, por qué y con qué marcas.
const services = useServices()
const entries = ref<AuditEntry[]>([])
const action = ref('')
const from = ref('')
const to = ref('')
const onlyFlagged = ref(false)
const loading = ref(false)
const more = ref(true)
const error = ref<string | null>(null)
const PAGE = 50

const ACTIONS: Record<string, string> = {
  'sale.register': 'Venta',
  'sale.void': 'Anulación de venta',
  'stock.add': 'Compra',
  'stock.consume': 'Consumo de insumo',
  'stock.adjust': 'Ajuste de stock',
  'stock.void_entry': 'Compra anulada',
  'product.create': 'Producto creado',
  'product.update': 'Producto editado',
  'price.set': 'Cambio de precio',
  'setting.set': 'Ajuste cambiado',
  'user.create': 'Usuario creado',
  'user.role': 'Cambio de rol',
  'user.active': 'Usuario activado/desactivado',
  'user.password_reset': 'Clave reseteada',
  'user.rename': 'Usuario renombrado',
  'role_permission.set': 'Permiso de rol',
}
const FILTERS: [string, string][] = [
  ['', 'Todo'],
  ['sale', 'Ventas'],
  ['stock', 'Stock'],
  ['price', 'Precios'],
  ['product', 'Productos'],
  ['user', 'Usuarios'],
  ['role_permission', 'Permisos'],
  ['setting', 'Ajustes'],
]

function summary(e: AuditEntry): string {
  const d = e.detail as Record<string, any>
  switch (e.action) {
    case 'sale.register':
      return `${formatMoney(d.total)} · ${d.payment_method}`
    case 'sale.void':
      return `${formatMoney(d.total)} · ${d.mode === 'any' ? 'por admin' : 'propia'}`
    case 'stock.add':
      return `${d.quantity} × ${d.product} · ${formatMoney(d.total_cost)}${d.note ? ` · ${d.note}` : ''}`
    case 'stock.consume':
      return `${d.quantity} × ${d.product}`
    case 'stock.adjust':
      return `${d.product} ${d.delta > 0 ? '+' : ''}${d.delta} (antes ${d.stock_before})`
    case 'price.set':
      return `${formatMoney(d.before)} → ${formatMoney(d.after)}`
    case 'user.role':
      return `${d.before} → ${d.after}`
    case 'role_permission.set':
      return `${d.role}: ${d.permission} ${d.enabled ? 'activado' : 'desactivado'}`
    case 'setting.set':
      return `${e.entityId}: ${JSON.stringify(d.before)} → ${JSON.stringify(d.after)}`
    case 'user.create':
      return `@${d.username} (${d.role})`
    case 'product.create':
      return `${d.name}`
    default:
      return ''
  }
}

async function load(reset = true) {
  loading.value = true
  error.value = null
  try {
    const before = reset ? undefined : entries.value.at(-1)?.id
    const page = await services.history.list({
      action: action.value || undefined,
      from: from.value || undefined,
      to: to.value || undefined,
      onlyFlagged: onlyFlagged.value,
      before,
      limit: PAGE,
    })
    entries.value = reset ? page : [...entries.value, ...page]
    more.value = page.length === PAGE
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    loading.value = false
  }
}
onMounted(() => load())
</script>

<template>
  <main class="page">
    <h1>Historial</h1>
    <form @submit.prevent="load()">
      <select v-model="action" aria-label="Tipo" @change="load()">
        <option v-for="[k, l] in FILTERS" :key="k" :value="k">{{ l }}</option>
      </select>
      <div class="row">
        <input v-model="from" type="date" aria-label="Desde" class="grow" />
        <input v-model="to" type="date" aria-label="Hasta" class="grow" />
      </div>
      <div class="row" style="justify-content: space-between; margin: 0.4rem 0 0.8rem">
        <label class="row"><input v-model="onlyFlagged" type="checkbox" role="switch" @change="load()" /> Solo con marcas</label>
        <button style="width: auto">Filtrar</button>
      </div>
    </form>
    <p v-if="error" class="err-text">{{ error }}</p>
    <ul class="list">
      <li v-for="e in entries" :key="e.id">
        <div class="line">
          <strong>{{ ACTIONS[e.action] ?? e.action }}</strong>
          <span class="muted">{{ formatDateTime(e.at) }}</span>
        </div>
        <div>{{ summary(e) }}</div>
        <div class="muted">{{ e.actorName }}<span v-if="e.reason"> · “{{ e.reason }}”</span></div>
        <span v-for="f in e.flags" :key="f" class="chip warn">{{ flagLabel(f) }}</span>
      </li>
    </ul>
    <p v-if="loading" aria-busy="true">Cargando…</p>
    <button v-else-if="more && entries.length" class="outline" @click="load(false)">Ver más</button>
  </main>
</template>
