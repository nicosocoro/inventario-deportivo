<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useServices } from '../../shared/container'
import BottomSheet from '../../shared/BottomSheet.vue'
import { toast } from '../../shared/toast'
import { errorMessage } from '../../shared/errors'
import { formatMoney } from '../../shared/money'
import { addDays, formatDateTime, localDay } from '../../shared/dates'
import { PAYMENT_LABELS } from '../domain/payment'
import { flagLabel, type Sale } from '../domain/sale'
import { can } from '../../users/web/session'

// Ventas de un período; un admin con sales.void_any anula cualquiera de los últimos 30 días.
const services = useServices()
const from = ref(addDays(localDay(new Date()), -6))
const to = ref(localDay(new Date()))
const onlyFlagged = ref(false)
const sales = ref<Sale[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

async function load() {
  loading.value = true
  error.value = null
  try {
    sales.value = await services.sales.listSales({ from: from.value, to: to.value, onlyFlagged: onlyFlagged.value })
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    loading.value = false
  }
}
onMounted(load)

const within30 = (s: Sale) => Date.now() - new Date(s.createdAt).getTime() < 30 * 86_400_000

const voiding = ref<Sale | null>(null)
const reason = ref('')
const busy = ref(false)
async function confirmVoid() {
  busy.value = true
  try {
    await services.sales.void({ saleId: voiding.value!.id, reason: reason.value.trim(), deviceVoidedAt: new Date().toISOString() })
    toast('Venta anulada')
    voiding.value = null
    await load()
  } catch (e) {
    toast(errorMessage(e), 'error')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <main class="page">
    <h1>Ventas</h1>
    <form class="row" style="flex-wrap: wrap" @submit.prevent="load">
      <input v-model="from" type="date" aria-label="Desde" class="grow" />
      <input v-model="to" type="date" aria-label="Hasta" class="grow" />
      <label class="row"><input v-model="onlyFlagged" type="checkbox" role="switch" /> Solo con marcas</label>
      <button style="width: auto">Ver</button>
    </form>
    <p v-if="error" class="err-text">{{ error }}</p>
    <p v-if="loading" aria-busy="true">Cargando…</p>
    <ul v-else class="list">
      <li v-for="s in sales" :key="s.id" :style="{ opacity: s.status === 'anulada' ? 0.6 : 1 }">
        <div class="line">
          <span>{{ formatDateTime(s.createdAt) }} · {{ s.sellerName }}</span>
          <strong :style="{ textDecoration: s.status === 'anulada' ? 'line-through' : undefined }">{{ formatMoney(s.total) }}</strong>
        </div>
        <div class="muted">{{ s.items?.map((i) => `${i.quantity}× ${i.name}`).join(', ') }}</div>
        <div class="muted">
          {{ PAYMENT_LABELS[s.paymentMethod] }}<span v-if="s.paymentMethod === 'mixto'"> (ef. {{ formatMoney(s.cashAmount) }} / tr. {{ formatMoney(s.transferAmount) }})</span
          ><span v-if="s.transferLast4"> · ·{{ s.transferLast4 }}</span>
        </div>
        <span v-for="f in s.flags" :key="f" class="chip warn">{{ flagLabel(f) }}</span>
        <div v-if="s.status === 'anulada'" class="muted"><span class="chip err">Anulada</span> {{ s.voidReason }}</div>
        <button
          v-else-if="can('sales.void_any') && within30(s)"
          class="secondary outline"
          style="width: auto; padding: 0.3rem 0.9rem; margin: 0.3rem 0 0"
          @click="((voiding = s), (reason = ''))"
        >
          Anular
        </button>
      </li>
      <li v-if="!sales.length" class="muted">No hay ventas en el período.</li>
    </ul>

    <BottomSheet :open="!!voiding" title="Anular venta" @close="voiding = null">
      <form v-if="voiding" @submit.prevent="confirmVoid">
        <p>{{ formatDateTime(voiding.createdAt) }} · {{ voiding.sellerName }} · {{ formatMoney(voiding.total) }}</p>
        <label for="r">Motivo<input id="r" v-model="reason" required /></label>
        <button class="big secondary" :aria-busy="busy" :disabled="busy || !reason.trim()">Anular venta</button>
      </form>
    </BottomSheet>
  </main>
</template>
