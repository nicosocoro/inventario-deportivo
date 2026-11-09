<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import { useServices } from '../../shared/container'
import { toast } from '../../shared/toast'
import { errorMessage } from '../../shared/errors'
import { formatMoney } from '../../shared/money'
import { formatDateTime, formatDay, formatTime, isValidDay, localDay, type DayRange } from '../../shared/dates'
import { shareOrDownload, type ShareResult } from '../../shared/share-file'
import { PERIOD_LABELS, hasIncidents, periodRange, periodTitle, type BalanceReport, type PeriodKind } from '../domain/balance'
import { flagLabel } from '../domain/sale'
import { buildBalanceCsv } from '../infra/balance-csv'
import { session } from '../../users/web/session'

const services = useServices()
const kind = ref<PeriodKind>('hoy')
const custom = ref<DayRange>({ from: localDay(new Date()), to: localDay(new Date()) })
const lastDay = ref<string | null>(null)
const report = ref<BalanceReport | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const exporting = ref<'pdf' | 'csv' | null>(null)

const range = computed(() => periodRange(kind.value, localDay(new Date()), lastDay.value, custom.value))

async function load() {
  error.value = null
  if (kind.value === 'custom' && (!isValidDay(custom.value.from) || !isValidDay(custom.value.to) || custom.value.to < custom.value.from)) {
    error.value = 'Fechas inválidas'
    return
  }
  loading.value = true
  try {
    if (kind.value === 'partido') lastDay.value = await services.sales.lastSaleDay()
    report.value = await services.sales.balance(range.value.from, range.value.to)
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    loading.value = false
  }
}
// jsPDF se precarga al abrir la vista, para no esperar la descarga al tocar "Generar PDF".
type PdfModule = typeof import('../infra/balance-pdf')
let pdfMod: Promise<PdfModule> | null = null
const loadPdfModule = () => {
  pdfMod ??= import('../infra/balance-pdf').catch((e) => {
    pdfMod = null // sin señal y sin caché: se reintenta al tocar
    throw e
  })
  return pdfMod
}
onMounted(() => {
  void load()
  loadPdfModule().catch(() => {})
})

function choose(k: PeriodKind) {
  kind.value = k
  void load()
}

const fileBase = computed(() => `balance-${range.value.from}${range.value.to !== range.value.from ? `_${range.value.to}` : ''}`)

// El PDF va en dos toques: en iOS, share() pierde el permiso del toque si antes hay awaits
// (cargar jsPDF y armar el archivo). Primero se genera; el segundo toque comparte sin esperas.
const pdfBlob = shallowRef<Blob | null>(null)
watch([report, range], () => {
  pdfBlob.value = null
})

function afterShare(r: ShareResult, what: string) {
  if (r === 'downloaded') toast(`${what} descargado`)
  else if (r === 'blocked') toast('Tocá Compartir de nuevo')
}

async function generatePdf() {
  if (!report.value) return
  exporting.value = 'pdf'
  try {
    const { buildBalancePdf } = await loadPdfModule()
    pdfBlob.value = await buildBalancePdf(report.value, session.user?.displayName ?? session.user?.username ?? '')
  } catch (e) {
    toast(errorMessage(e), 'error')
  } finally {
    exporting.value = null
  }
}

async function sharePdf() {
  if (!pdfBlob.value) return
  try {
    // Sin awaits antes de shareOrDownload (activación del toque en Safari).
    afterShare(await shareOrDownload(pdfBlob.value, `${fileBase.value}.pdf`, `Balance ${periodTitle(range.value)}`), 'PDF')
  } catch (e) {
    toast(errorMessage(e), 'error')
  }
}

async function exportCsv() {
  if (!report.value) return
  exporting.value = 'csv'
  try {
    afterShare(await shareOrDownload(buildBalanceCsv(report.value), `${fileBase.value}.csv`, `Balance ${periodTitle(range.value)}`), 'CSV')
  } catch (e) {
    toast(errorMessage(e), 'error')
  } finally {
    exporting.value = null
  }
}
</script>

<template>
  <main class="page">
    <h1>Balance</h1>
    <div class="seg" role="group" aria-label="Período" style="grid-auto-flow: row; grid-template-columns: repeat(3, 1fr)">
      <button v-for="k in (Object.keys(PERIOD_LABELS) as PeriodKind[])" :key="k" type="button" :aria-pressed="kind === k" @click="choose(k)">
        {{ PERIOD_LABELS[k] }}
      </button>
    </div>
    <form v-if="kind === 'custom'" class="row" @submit.prevent="load">
      <input v-model="custom.from" type="date" aria-label="Desde" />
      <input v-model="custom.to" type="date" aria-label="Hasta" />
      <button style="width: auto">Ver</button>
    </form>

    <p class="muted">{{ periodTitle(range) }}<span v-if="kind === 'partido' && lastDay"> ({{ formatDay(lastDay) }})</span></p>
    <p v-if="error" class="err-text">{{ error }}</p>
    <p v-if="loading" aria-busy="true">Calculando…</p>

    <template v-if="report && !loading">
      <div class="stats">
        <div class="stat"><div class="label">Ingresos</div><div class="value">{{ formatMoney(report.income.total) }}</div></div>
        <div class="stat"><div class="label">Egresos</div><div class="value">{{ formatMoney(report.expenses.total) }}</div></div>
        <div class="stat" :class="{ neg: report.result < 0 }"><div class="label">Resultado</div><div class="value">{{ formatMoney(report.result) }}</div></div>
        <div class="stat"><div class="label">Efectivo</div><div class="value">{{ formatMoney(report.by_method.cash) }}</div></div>
        <div class="stat"><div class="label">Transferencias</div><div class="value">{{ formatMoney(report.by_method.transfer) }}</div></div>
      </div>
      <p class="muted">
        {{ report.income.count }} ventas · ticket promedio {{ formatMoney(report.income.average) }} · {{ report.by_method.count_mixto }} mixtas
      </p>

      <div class="actions no-print" style="margin-bottom: 1rem">
        <button v-if="pdfBlob" class="big" :disabled="!!exporting" @click="sharePdf">Compartir PDF</button>
        <button v-else class="big" :aria-busy="exporting === 'pdf'" :disabled="!!exporting" @click="generatePdf">Generar PDF</button>
        <button class="big outline" :aria-busy="exporting === 'csv'" :disabled="!!exporting" @click="exportCsv">CSV</button>
      </div>

      <div v-if="report.stock_alerts.length" class="notice warn">
        Stock bajo o negativo: {{ report.stock_alerts.map((s) => `${s.name} (${s.stock})`).join(', ') }}
      </div>

      <details class="section" open>
        <summary>Por vendedor (para rendir el efectivo)</summary>
        <ul class="list">
          <li v-for="s in report.by_seller" :key="s.username">
            <div class="line"><span>{{ s.display_name ?? s.username }} · {{ s.count }} ventas</span><strong>{{ formatMoney(s.amount) }}</strong></div>
            <div class="muted">Efectivo {{ formatMoney(s.cash) }} · Transferencias {{ formatMoney(s.transfer) }}</div>
          </li>
        </ul>
      </details>

      <details class="section">
        <summary>Ventas por producto</summary>
        <ul class="list">
          <li v-for="p in report.by_product" :key="p.product_id" class="line">
            <span>{{ p.units }} × {{ p.name }}</span><strong>{{ formatMoney(p.amount) }}</strong>
          </li>
        </ul>
      </details>

      <details class="section">
        <summary>Egresos (compras)</summary>
        <ul class="list">
          <li v-for="e in report.expenses.by_product" :key="e.product_id" class="line">
            <span>{{ e.quantity }} × {{ e.name }}</span><strong>{{ formatMoney(e.cost) }}</strong>
          </li>
          <li v-for="m in report.misc_details" :key="m.at" class="muted">{{ formatDateTime(m.at) }} · {{ m.note }} · {{ formatMoney(m.cost) }}</li>
        </ul>
      </details>

      <details v-if="report.supplies.length" class="section">
        <summary>Insumos</summary>
        <ul class="list">
          <li v-for="s in report.supplies" :key="s.product_id" class="line">
            <span>{{ s.name }} · compradas {{ s.bought }} · usadas {{ s.consumed }}</span><strong>stock {{ s.stock }}</strong>
          </li>
        </ul>
      </details>

      <details v-if="report.by_day.length > 1" class="section">
        <summary>Por día</summary>
        <ul class="list">
          <li v-for="d in report.by_day" :key="d.day" class="line">
            <span>{{ formatDay(d.day) }} · {{ d.count }} ventas</span><strong>{{ formatMoney(d.amount) }}</strong>
          </li>
        </ul>
      </details>

      <details v-if="report.transfers.length" class="section">
        <summary>Transferencias ({{ report.transfers.length }})</summary>
        <ul class="list">
          <li v-for="t in report.transfers" :key="t.sale_id" class="line">
            <span>{{ formatDateTime(t.at) }} · ·{{ t.last4 }} · {{ t.seller }}<span v-if="t.mixed" class="chip">mixta</span></span>
            <strong>{{ formatMoney(t.amount) }}</strong>
          </li>
        </ul>
      </details>

      <details v-if="hasIncidents(report)" class="section" open>
        <summary>Incidencias</summary>
        <ul class="list">
          <li v-for="v in report.incidents.voids" :key="v.sale_id">
            <span class="chip err">Anulada</span> {{ formatMoney(v.total) }} · venta {{ formatTime(v.sale_at) }}, anulada {{ formatTime(v.voided_at) }}
            <div class="muted">{{ v.reason }} · {{ v.voided_by }}<span v-if="v.by_other"> (venta de {{ v.seller }})</span></div>
          </li>
          <li v-for="a in report.incidents.adjustments" :key="a.at + a.name">
            <span class="chip warn">Ajuste</span> {{ a.name }} {{ a.quantity > 0 ? '+' : '' }}{{ a.quantity }}
            <div class="muted">{{ a.note }} · {{ a.user }} · {{ formatDateTime(a.at) }}</div>
          </li>
          <li v-for="e in report.incidents.voided_entries" :key="e.at + e.name">
            <span class="chip warn">Compra anulada</span> {{ e.name }} {{ formatMoney(e.cost) }}
            <div class="muted">{{ e.note }} · {{ e.user }}</div>
          </li>
          <li v-for="s in report.incidents.flagged_sales" :key="s.sale_id">
            {{ formatTime(s.at) }} · {{ formatMoney(s.total) }} · {{ s.seller }}
            <span v-for="f in s.flags" :key="f" class="chip warn">{{ flagLabel(f) }}</span>
            <span v-if="s.status === 'anulada'" class="chip err">anulada</span>
          </li>
        </ul>
      </details>
      <p class="muted">Para el cierre de caja: contá el efectivo y comparalo con el efectivo de este balance (total o por vendedor).</p>
    </template>
  </main>
</template>
