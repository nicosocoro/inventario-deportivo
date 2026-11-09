<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useServices } from '../../shared/container'
import BottomSheet from '../../shared/BottomSheet.vue'
import MoneyInput from '../../shared/MoneyInput.vue'
import { toast } from '../../shared/toast'
import { formatMoney } from '../../shared/money'
import { newId } from '../../shared/ids'
import { keepScreenOn } from '../../shared/device'
import { catalog } from '../../inventory/web/catalog'
import { registerProducts } from '../../inventory/domain/product'
import { addOne, cartTotal, cartUnits, negativeStockLines, quantityOf, setQuantity, type CartLine } from '../domain/cart'
import { PAYMENT_LABELS, autocompleteMixed, change, validatePayment, type PaymentMethod } from '../domain/payment'
import { can, session } from '../../users/web/session'
import { syncNow } from './sync'

const services = useServices()
const products = computed(() => registerProducts(catalog.products))
const cart = ref<CartLine[]>([])
const total = computed(() => cartTotal(cart.value))
const units = computed(() => cartUnits(cart.value))

const catalogAgeMin = computed(() => (catalog.savedAt ? Math.round((Date.now() - new Date(catalog.savedAt).getTime()) / 60_000) : null))

let releaseWakeLock: (() => void) | null = null
onMounted(async () => {
  releaseWakeLock = await keepScreenOn()
})
onBeforeUnmount(() => releaseWakeLock?.())

function tap(id: string) {
  const p = products.value.find((x) => x.id === id)
  if (p) cart.value = addOne(cart.value, p)
}

// ---- detalle
const showCart = ref(false)
function changeQty(id: string, q: number) {
  cart.value = setQuantity(cart.value, id, q)
  if (cart.value.length === 0) showCart.value = false
}

// ---- cobro
const paying = ref(false)
const method = ref<PaymentMethod>('efectivo')
const last4 = ref('')
const transfer = ref<number | null>(null)
const cash = ref<number | null>(null)
const paysWith = ref<number | null>(null)
const acceptNegative = ref(false)
const backdate = ref(false)
const backdateAt = ref('')
const payError = ref<string | null>(null)
const saving = ref(false)

const negatives = computed(() => negativeStockLines(cart.value, catalog.products))
const vuelto = computed(() => change(total.value, paysWith.value))

function openPay() {
  method.value = 'efectivo'
  last4.value = ''
  transfer.value = null
  cash.value = null
  paysWith.value = null
  acceptNegative.value = false
  backdate.value = false
  backdateAt.value = ''
  payError.value = null
  showCart.value = false
  paying.value = true
}

// Mixto: el último campo editado manda; el otro se completa con total − monto.
let lock = false
watch(transfer, (v) => {
  if (lock || method.value !== 'mixto') return
  lock = true
  cash.value = autocompleteMixed(total.value, 'transfer', v).cash
  lock = false
})
watch(cash, (v) => {
  if (lock || method.value !== 'mixto') return
  lock = true
  transfer.value = autocompleteMixed(total.value, 'cash', v).transfer
  lock = false
})

function onLast4(e: Event) {
  last4.value = (e.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 4)
}

async function confirm() {
  payError.value = validatePayment(total.value, { method: method.value, transferAmount: transfer.value, cashAmount: cash.value, last4: last4.value })
  if (!payError.value && negatives.value.length && !acceptNegative.value) payError.value = 'Confirmá que querés vender sin stock cargado'
  let at = new Date()
  if (!payError.value && backdate.value) {
    const d = new Date(backdateAt.value)
    if (Number.isNaN(d.getTime()) || d > new Date()) payError.value = 'Elegí la fecha y hora de la venta'
    else at = d
  }
  if (payError.value) return
  const user = session.user!
  saving.value = true
  try {
    const op = await services.outbox.enqueueSale(user.id, {
      id: newId(),
      items: cart.value,
      payment: method.value,
      transferAmount: method.value === 'mixto' ? transfer.value : null,
      last4: method.value === 'efectivo' ? null : last4.value,
      deviceCreatedAt: at.toISOString(),
      clientTotal: total.value,
    })
    cart.value = []
    paying.value = false
    toast(`Guardada en el teléfono · ${formatMoney(op.sale.clientTotal)}`, 'info', 2000)
    await syncNow()
    const after = (await services.outbox.all()).find((o) => o.id === op.id)
    if (after?.status === 'synced') {
      const adjusted = after.result?.flags.includes('pago_ajustado') || after.result?.flags.includes('precio_distinto')
      toast(adjusted ? `Sincronizada ✓ · el servidor ajustó el total a ${formatMoney(after.result!.total)}` : 'Sincronizada ✓', adjusted ? 'warn' : 'ok', adjusted ? 6000 : 2500)
    }
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <main class="page with-total">
    <div v-if="catalog.products.length === 0" class="notice warn">
      No hay productos cargados en el teléfono. Conectate a internet para descargarlos.
    </div>
    <div v-else-if="catalogAgeMin !== null && catalogAgeMin > 60" class="notice warn">
      Precios actualizados hace {{ catalogAgeMin > 1440 ? `${Math.round(catalogAgeMin / 1440)} días` : `${Math.round(catalogAgeMin / 60)} h` }}.
      Conectate para actualizarlos.
    </div>

    <div class="register-grid">
      <button
        v-for="p in products"
        :key="p.id"
        type="button"
        class="product-btn"
        :class="{ 'no-stock': p.stock - quantityOf(cart, p.id) < 0 || p.stock <= 0, 'in-cart': quantityOf(cart, p.id) > 0 }"
        @click="tap(p.id)"
      >
        <span>{{ p.name }}</span>
        <span class="price">{{ formatMoney(p.price) }}</span>
        <span v-if="quantityOf(cart, p.id)" class="count">{{ quantityOf(cart, p.id) }}</span>
      </button>
    </div>

    <div class="total-bar">
      <button type="button" class="summary" :disabled="!cart.length" @click="showCart = true">
        <span v-if="cart.length">{{ units }} {{ units === 1 ? 'ítem' : 'ítems' }} · <strong>{{ formatMoney(total) }}</strong> ▴</span>
        <span v-else class="muted">Tocá los productos para vender</span>
      </button>
      <button type="button" class="primary" :disabled="!cart.length" @click="openPay">Cobrar</button>
    </div>

    <BottomSheet :open="showCart" title="Detalle" @close="showCart = false">
      <ul class="list">
        <li v-for="l in cart" :key="l.productId" class="line">
          <div>
            <div>{{ l.name }}</div>
            <div class="muted">{{ formatMoney(l.shownPrice) }} c/u</div>
          </div>
          <div class="qty">
            <button type="button" class="outline" aria-label="Uno menos" @click="changeQty(l.productId, l.quantity - 1)">−</button>
            <span>{{ l.quantity }}</span>
            <button type="button" class="outline" aria-label="Uno más" @click="changeQty(l.productId, l.quantity + 1)">+</button>
          </div>
        </li>
      </ul>
      <div class="line row" style="justify-content: space-between; margin: 0.8rem 0">
        <strong>Total</strong><strong>{{ formatMoney(total) }}</strong>
      </div>
      <div class="actions">
        <button type="button" class="secondary outline" @click="((cart = []), (showCart = false))">Vaciar</button>
        <button type="button" class="grow big" @click="openPay">Cobrar {{ formatMoney(total) }}</button>
      </div>
    </BottomSheet>

    <BottomSheet :open="paying" :title="`Cobrar ${formatMoney(total)}`" @close="paying = false">
      <form @submit.prevent="confirm">
        <div class="seg" role="group" aria-label="Medio de pago">
          <button v-for="m in (['efectivo', 'transferencia', 'mixto'] as const)" :key="m" type="button" :aria-pressed="method === m" @click="method = m">
            {{ PAYMENT_LABELS[m] }}
          </button>
        </div>

        <template v-if="method === 'efectivo'">
          <MoneyInput id="pw" v-model="paysWith" label="Paga con (opcional, para el vuelto)" />
          <p v-if="vuelto !== null" class="notice">Vuelto: <strong>{{ formatMoney(vuelto) }}</strong></p>
        </template>

        <template v-if="method === 'mixto'">
          <div class="row">
            <div class="grow"><MoneyInput id="mt" v-model="transfer" label="Transferido" /></div>
            <div class="grow"><MoneyInput id="mc" v-model="cash" label="Efectivo" /></div>
          </div>
        </template>

        <label v-if="method !== 'efectivo'" for="l4">
          Últimos 4 números de la transferencia
          <input id="l4" :value="last4" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="1234" @input="onLast4" />
        </label>

        <div v-if="negatives.length" class="notice warn">
          Sin stock cargado de <strong>{{ negatives.map((l) => l.name).join(', ') }}</strong>.
          <label class="row" style="margin-top: 0.4rem"><input v-model="acceptNegative" type="checkbox" /> Vender igual</label>
        </div>

        <details v-if="can('sales.backdate')">
          <summary class="muted">Venta de otro momento (cargada desde papel)</summary>
          <label class="row"><input v-model="backdate" type="checkbox" role="switch" /> Usar otra fecha y hora</label>
          <input v-if="backdate" v-model="backdateAt" type="datetime-local" aria-label="Fecha y hora de la venta" />
        </details>

        <p v-if="payError" class="err-text" role="alert">{{ payError }}</p>
        <button class="big" type="submit" :aria-busy="saving" :disabled="saving">Confirmar</button>
      </form>
    </BottomSheet>
  </main>
</template>
