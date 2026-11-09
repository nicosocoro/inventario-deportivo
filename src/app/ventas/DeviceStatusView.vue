<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useServices } from '../../shared/container'
import { isIos, isPersisted, isStandalone, requestPersistentStorage } from '../../shared/device'
import { formatDateTime } from '../../shared/dates'
import { online } from '../../shared/online'
import { catalog } from '../../inventory/web/catalog'
import { syncNow, syncState } from '../../sales/web/sync'
import type { OutboxOp } from '../../sales/domain/outbox'
import { formatMoney } from '../../shared/money'

// Checklist antes del partido y diagnóstico.
const services = useServices()
const installed = isStandalone()
const ios = isIos()
const persisted = ref<boolean | null>(null)
const rejected = ref<OutboxOp[]>([])

async function load() {
  persisted.value = await isPersisted()
  rejected.value = (await services.outbox.all()).filter((o) => o.status === 'rejected')
}
onMounted(load)

async function askPersist() {
  persisted.value = await requestPersistentStorage()
}

async function dismiss(id: string) {
  await services.outbox.dismiss(id)
  await load()
}

const yes = (v: boolean | null) => (v === null ? 'No se sabe' : v ? 'Sí ✓' : 'No')
</script>

<template>
  <main class="page">
    <h1>Estado del teléfono</h1>
    <ul class="list">
      <li class="line"><span>App instalada (abierta desde el ícono)</span><strong>{{ yes(installed) }}</strong></li>
      <li class="line"><span>Con señal</span><strong>{{ yes(online) }}</strong></li>
      <li class="line">
        <span>Almacenamiento persistente</span>
        <strong>{{ yes(persisted) }} <button v-if="persisted === false" class="outline" style="width: auto; padding: 0.2rem 0.6rem" @click="askPersist">Pedir</button></strong>
      </li>
      <li class="line"><span>Ventas pendientes de sincronizar</span><strong>{{ syncState.pending }}</strong></li>
      <li class="line"><span>Operaciones rechazadas</span><strong>{{ syncState.rejected }}</strong></li>
      <li class="line"><span>Última sincronización</span><strong>{{ syncState.lastSync ? formatDateTime(syncState.lastSync) : '—' }}</strong></li>
      <li class="line"><span>Catálogo descargado</span><strong>{{ catalog.savedAt ? formatDateTime(catalog.savedAt) : 'Nunca' }}</strong></li>
    </ul>
    <button class="big" :aria-busy="syncState.syncing" @click="syncNow({ manual: true })">Sincronizar ahora</button>

    <h2>Antes del partido</h2>
    <ol>
      <li>La app está instalada y la abrís desde el ícono{{ ios ? ' (en iPhone es obligatorio)' : '' }}.</li>
      <li>La abrís <strong>con señal</strong> y con tu usuario (descarga precios y permisos).</li>
      <li>Acá dice 0 pendientes y el catálogo es de hoy.</li>
      <li>Al terminar: abrí la app con señal hasta ver <strong>0 pendientes</strong>.</li>
    </ol>
    <p v-if="ios" class="muted">En iPhone las ventas se envían solo con la app abierta: abrila cuando vuelvas a tener señal.</p>

    <template v-if="rejected.length">
      <h2>Rechazadas</h2>
      <p class="muted">No se borran solas. Avisale a un admin; cuando esté resuelto, podés descartarlas.</p>
      <ul class="list">
        <li v-for="o in rejected" :key="o.id">
          <div class="line">
            <span>{{ o.kind === 'sale' ? 'Venta' : 'Anulación' }} · {{ formatDateTime(o.createdAt) }}</span>
            <strong v-if="o.kind === 'sale'">{{ formatMoney(o.sale.clientTotal) }}</strong>
          </div>
          <div v-if="o.kind === 'sale'" class="muted">{{ o.sale.items.map((i) => `${i.quantity}× ${i.name}`).join(', ') }}</div>
          <p class="err-text">{{ o.error }}</p>
          <button class="secondary outline" style="width: auto; padding: 0.25rem 0.8rem" @click="dismiss(o.id)">Descartar</button>
        </li>
      </ul>
    </template>
  </main>
</template>
