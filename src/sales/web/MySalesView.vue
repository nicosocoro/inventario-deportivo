<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useServices } from '../../shared/container'
import BottomSheet from '../../shared/BottomSheet.vue'
import { toast } from '../../shared/toast'
import { formatMoney } from '../../shared/money'
import { formatDateTime, formatTime, localDay } from '../../shared/dates'
import { online } from '../../shared/online'
import { mySalesToday, type MySaleRow } from '../domain/outbox'
import { canVoidOwn, voidDeadline } from '../domain/void-rules'
import { PAYMENT_LABELS, type PaymentMethod } from '../domain/payment'
import { flagLabel, type Sale } from '../domain/sale'
import { can, session } from '../../users/web/session'
import { syncNow, syncState } from './sync'

const services = useServices()
const rows = ref<MySaleRow[]>([])
const server = ref<Sale[]>([])
const now = ref(new Date())
const user = computed(() => session.user!)

async function load() {
  now.value = new Date()
  if (online.value) {
    try {
      server.value = await services.sales.listMineToday()
    } catch {
      /* se muestra lo del teléfono */
    }
  }
  rows.value = mySalesToday(await services.outbox.all(), server.value, user.value.id, now.value)
}

let off: (() => void) | null = null
let timer: ReturnType<typeof setInterval> | null = null
onMounted(async () => {
  await load()
  off = services.outbox.onChange(async () => {
    rows.value = mySalesToday(await services.outbox.all(), server.value, user.value.id, new Date())
  })
  timer = setInterval(() => (now.value = new Date()), 30_000)
})
onBeforeUnmount(() => {
  off?.()
  if (timer) clearInterval(timer)
})

/** Hora si es de hoy; fecha y hora si es una pendiente o rechazada de otro día. */
function when(iso: string) {
  return localDay(iso) === localDay(now.value) ? formatTime(iso) : formatDateTime(iso)
}

const totals = computed(() => {
  // Los totales son del día: no suman pendientes de días anteriores.
  const today = localDay(now.value)
  const ok = rows.value.filter((r) => r.status === 'ok' && localDay(r.createdAt) === today)
  return {
    count: ok.length,
    total: ok.reduce((s, r) => s + r.total, 0),
    cash: ok.reduce((s, r) => s + r.cashAmount, 0),
    transfer: ok.reduce((s, r) => s + r.transferAmount, 0),
  }
})

const windowMin = computed(() => user.value.settings.void_own_window_minutes)
function canVoid(r: MySaleRow) {
  return (
    r.sync !== 'rejected' &&
    r.voidSync === null &&
    canVoidOwn(
      { createdAt: r.createdAt, createdBy: user.value.id, status: r.status },
      { userId: user.value.id, now: now.value, windowMinutes: windowMin.value, canVoidOwnSameDay: can('sales.void_own_same_day') },
    )
  )
}
function deadline(r: MySaleRow) {
  const d = voidDeadline(r.createdAt, windowMin.value)
  return d ? formatTime(d) : null
}

const voiding = ref<MySaleRow | null>(null)
const reason = ref('')
async function confirmVoid() {
  if (!reason.value.trim()) return
  await services.outbox.enqueueVoid(user.value.id, { saleId: voiding.value!.id, reason: reason.value.trim(), deviceVoidedAt: new Date().toISOString() })
  voiding.value = null
  toast('Anulación guardada en el teléfono', 'info', 2000)
  await syncNow()
  await load()
}

async function refresh() {
  await syncNow({ manual: true })
  await load()
}
</script>

<template>
  <main class="page">
    <div class="row" style="justify-content: space-between">
      <h1>Mis ventas de hoy</h1>
      <button class="outline" style="width: auto" :aria-busy="syncState.syncing" @click="refresh">Sincronizar</button>
    </div>
    <div v-if="syncState.pending" class="notice warn">{{ syncState.pending }} pendientes de sincronizar. Se envían solas cuando haya señal.</div>

    <div class="stats">
      <div class="stat"><div class="label">Ventas</div><div class="value">{{ totals.count }}</div></div>
      <div class="stat"><div class="label">Total</div><div class="value">{{ formatMoney(totals.total) }}</div></div>
      <div class="stat"><div class="label">Efectivo</div><div class="value">{{ formatMoney(totals.cash) }}</div></div>
      <div class="stat"><div class="label">Transferencias</div><div class="value">{{ formatMoney(totals.transfer) }}</div></div>
    </div>

    <p v-if="rows.length === 0" class="muted">Todavía no vendiste nada hoy.</p>
    <ul class="list">
      <li v-for="r in rows" :key="r.id" :style="{ opacity: r.status === 'anulada' ? 0.6 : 1 }">
        <div class="line">
          <span>{{ when(r.createdAt) }} · {{ PAYMENT_LABELS[r.paymentMethod as PaymentMethod] }}<span v-if="r.transferLast4"> ·{{ r.transferLast4 }}</span></span>
          <strong :style="{ textDecoration: r.status === 'anulada' ? 'line-through' : undefined }">{{ formatMoney(r.total) }}</strong>
        </div>
        <div class="muted">{{ r.items.map((i) => `${i.quantity}× ${i.name}`).join(', ') }}</div>
        <div v-if="r.paymentMethod === 'mixto'" class="muted">Efectivo {{ formatMoney(r.cashAmount) }} · Transferido {{ formatMoney(r.transferAmount) }}</div>
        <div>
          <span v-if="r.sync === 'pending'" class="chip warn">Pendiente</span>
          <span v-else-if="r.sync === 'synced'" class="chip ok">Sincronizada</span>
          <span v-else class="chip err">Rechazada</span>
          <span v-if="r.status === 'anulada'" class="chip err">Anulada</span>
          <span v-else-if="r.voidSync === 'pending'" class="chip warn">Anulación pendiente</span>
          <span v-else-if="r.voidSync === 'rejected'" class="chip err">Anulación rechazada</span>
          <span v-for="f in r.flags" :key="f" class="chip warn">{{ flagLabel(f) }}</span>
        </div>
        <p v-if="r.flags.includes('pago_ajustado')" class="muted">Efectivo ajustado a {{ formatMoney(r.cashAmount) }} por cambio de precio.</p>
        <p v-if="r.error" class="err-text">{{ r.error }} · Avisale a un admin.</p>
        <div v-if="r.status === 'ok' && r.voidSync === null" style="margin-top: 0.3rem">
          <button v-if="canVoid(r)" class="secondary outline" style="width: auto; padding: 0.3rem 0.9rem; margin: 0" @click="((voiding = r), (reason = ''))">
            Anular<span v-if="deadline(r)" class="muted"> (hasta {{ deadline(r) }})</span>
          </button>
          <span v-else-if="r.sync !== 'rejected'" class="muted">Para anular, pedíselo a un admin.</span>
        </div>
      </li>
    </ul>

    <BottomSheet :open="!!voiding" title="Anular venta" @close="voiding = null">
      <form v-if="voiding" @submit.prevent="confirmVoid">
        <p>{{ when(voiding.createdAt) }} · {{ formatMoney(voiding.total) }}</p>
        <label for="vr">Motivo<input id="vr" v-model="reason" placeholder="Ej: cobré de más, se arrepintió" required /></label>
        <button class="big secondary" :disabled="!reason.trim()">Anular venta</button>
      </form>
    </BottomSheet>
  </main>
</template>
