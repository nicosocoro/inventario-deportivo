<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useServices } from '../../shared/container'
import { toast } from '../../shared/toast'
import { errorMessage } from '../../shared/errors'
import { session } from './session'
import { EDITABLE_ROLES, ROLE_LABELS } from '../domain/permissions'
import type { RoleMatrix } from '../domain/ports'

const services = useServices()
const matrix = ref<RoleMatrix | null>(null)
const error = ref<string | null>(null)
const busyKey = ref<string | null>(null)
const isOwner = computed(() => session.user?.role === 'owner')

async function load() {
  try {
    matrix.value = await services.users.roleMatrix()
  } catch (e) {
    error.value = errorMessage(e)
  }
}
onMounted(load)

function has(role: 'venta' | 'admin', key: string) {
  return matrix.value?.granted.some((g) => g.role === role && g.permission === key) ?? false
}

async function toggle(role: 'venta' | 'admin', key: string) {
  const enabled = !has(role, key)
  busyKey.value = `${role}:${key}`
  try {
    await services.users.setRolePermission(role, key, enabled)
    await load()
    toast(`${ROLE_LABELS[role]}: ${enabled ? 'activado' : 'desactivado'}`)
  } catch (e) {
    toast(errorMessage(e), 'error')
  } finally {
    busyKey.value = null
  }
}
</script>

<template>
  <main class="page">
    <h1>Permisos por rol</h1>
    <p class="muted">
      El owner tiene todos los permisos siempre. Reglas fijas (no se cambian acá): un admin no le quita el rol a otro admin; el rol owner no se quita
      desde la web; nadie cambia su propio rol.
    </p>
    <div v-if="!isOwner" class="notice">Solo el owner puede cambiar los permisos.</div>
    <p v-if="error" class="err-text">{{ error }}</p>
    <ul v-if="matrix" class="list">
      <li v-for="p in matrix.permissions" :key="p.key">
        <div>{{ p.description }}</div>
        <div class="muted"><code>{{ p.key }}</code></div>
        <div class="row" style="margin-top: 0.4rem; gap: 1.2rem">
          <label v-for="r in EDITABLE_ROLES" :key="r" class="row" style="gap: 0.4rem">
            <input
              type="checkbox"
              role="switch"
              :checked="has(r, p.key)"
              :disabled="!isOwner || busyKey !== null"
              :aria-busy="busyKey === `${r}:${p.key}`"
              @change="toggle(r, p.key)"
            />
            {{ ROLE_LABELS[r] }}
          </label>
        </div>
      </li>
    </ul>
  </main>
</template>
