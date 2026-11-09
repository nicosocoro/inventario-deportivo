<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useServices } from '../../shared/container'
import BottomSheet from '../../shared/BottomSheet.vue'
import { toast } from '../../shared/toast'
import { errorMessage } from '../../shared/errors'
import { session } from './session'
import { ROLE_LABELS, USERNAME_RE, assignableRoles, canManageUser, normalizeUsername, type Role } from '../domain/permissions'
import type { UserProfile } from '../domain/ports'

const services = useServices()
const users = ref<UserProfile[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const me = computed(() => session.user!)
const roles = computed(() => assignableRoles(me.value))

async function load() {
  loading.value = true
  try {
    users.value = await services.users.list()
    error.value = null
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    loading.value = false
  }
}
onMounted(load)

// ---- alta
const creating = ref(false)
const form = ref({ username: '', displayName: '', password: '', role: 'venta' as Role })
const formError = ref<string | null>(null)
const busy = ref(false)

function openCreate() {
  form.value = { username: '', displayName: '', password: '', role: 'venta' }
  formError.value = null
  creating.value = true
}

async function create() {
  formError.value = null
  const username = normalizeUsername(form.value.username)
  if (!USERNAME_RE.test(username)) {
    formError.value = 'Usuario: 3 a 30 letras minúsculas, números, punto o guion (sin espacios)'
    return
  }
  if (form.value.password.length < 8) {
    formError.value = 'La contraseña tiene que tener al menos 8 caracteres'
    return
  }
  if (form.value.role === 'owner' && !confirm('Un owner no se puede quitar desde la web. ¿Crear igual?')) return
  busy.value = true
  try {
    await services.users.create({ username, displayName: form.value.displayName.trim() || null, password: form.value.password, role: form.value.role })
    toast(`Usuario ${username} creado`)
    creating.value = false
    await load()
  } catch (e) {
    formError.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}

// ---- edición
const editing = ref<UserProfile | null>(null)
const editName = ref('')
const editRole = ref<Role>('venta')
const newPass = ref('')
const editError = ref<string | null>(null)

function openEdit(u: UserProfile) {
  editing.value = u
  editName.value = u.displayName ?? ''
  editRole.value = u.role
  newPass.value = ''
  editError.value = null
}

async function run(action: () => Promise<void>, ok: string) {
  editError.value = null
  busy.value = true
  try {
    await action()
    toast(ok)
    await load()
    editing.value = users.value.find((u) => u.id === editing.value?.id) ?? null
  } catch (e) {
    editError.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}

const saveName = () => run(() => services.users.rename(editing.value!.id, editName.value.trim() || null), 'Nombre guardado')
const saveRole = () => {
  if (editRole.value === 'owner' && !confirm('Un owner no se puede quitar desde la web. ¿Seguro?')) return
  return run(() => services.users.setRole(editing.value!.id, editRole.value), 'Rol cambiado')
}
const toggleActive = () => run(() => services.users.setActive(editing.value!.id, !editing.value!.active), editing.value!.active ? 'Usuario desactivado' : 'Usuario reactivado')
const resetPass = () => run(() => services.users.resetPassword(editing.value!.id, newPass.value), 'Contraseña reseteada')
</script>

<template>
  <main class="page">
    <div class="row" style="justify-content: space-between">
      <h1>Usuarios</h1>
      <button v-if="roles.length" type="button" style="width: auto" @click="openCreate">+ Nuevo</button>
    </div>
    <p v-if="error" class="err-text">{{ error }}</p>
    <p v-if="loading" aria-busy="true">Cargando…</p>
    <ul v-else class="list">
      <li v-for="u in users" :key="u.id">
        <div class="line">
          <div>
            <strong>{{ u.displayName ?? u.username }}</strong>
            <div class="muted">@{{ u.username }}</div>
          </div>
          <div style="text-align: right">
            <span class="chip" :class="{ ok: u.role === 'owner' }">{{ ROLE_LABELS[u.role] }}</span>
            <span v-if="!u.active" class="chip err">Inactivo</span>
            <div v-if="u.id === me.id" class="muted">(vos)</div>
            <button v-else-if="canManageUser(me, u)" class="outline" style="width: auto; margin: 0.3rem 0 0; padding: 0.3rem 0.8rem" @click="openEdit(u)">
              Editar
            </button>
          </div>
        </div>
      </li>
    </ul>

    <BottomSheet :open="creating" title="Nuevo usuario" @close="creating = false">
      <form @submit.prevent="create">
        <label for="nu">Usuario (para entrar)<input id="nu" v-model="form.username" autocapitalize="none" autocorrect="off" spellcheck="false" required /></label>
        <label for="nn">Nombre a mostrar<input id="nn" v-model="form.displayName" /></label>
        <label for="npw">Contraseña inicial (mínimo 8)<input id="npw" v-model="form.password" type="text" autocomplete="off" required /></label>
        <label for="nr">
          Rol
          <select id="nr" v-model="form.role">
            <option v-for="r in roles" :key="r" :value="r">{{ ROLE_LABELS[r] }}</option>
          </select>
        </label>
        <p v-if="formError" class="err-text">{{ formError }}</p>
        <button class="big" :aria-busy="busy" :disabled="busy">Crear</button>
      </form>
    </BottomSheet>

    <BottomSheet :open="!!editing" :title="editing ? `@${editing.username}` : ''" @close="editing = null">
      <template v-if="editing">
        <form @submit.prevent="saveName">
          <label for="en">Nombre a mostrar<input id="en" v-model="editName" /></label>
          <button class="outline" :disabled="busy">Guardar nombre</button>
        </form>
        <form @submit.prevent="saveRole">
          <label for="er">
            Rol
            <select id="er" v-model="editRole">
              <option v-for="r in roles" :key="r" :value="r">{{ ROLE_LABELS[r] }}</option>
            </select>
          </label>
          <button class="outline" :disabled="busy || editRole === editing.role">Cambiar rol</button>
        </form>
        <form @submit.prevent="resetPass">
          <label for="ep">Nueva contraseña<input id="ep" v-model="newPass" type="text" autocomplete="off" minlength="8" /></label>
          <button class="outline" :disabled="busy || newPass.length < 8">Resetear contraseña</button>
        </form>
        <button :class="editing.active ? 'secondary' : ''" class="big" :disabled="busy" @click="toggleActive">
          {{ editing.active ? 'Desactivar usuario' : 'Reactivar usuario' }}
        </button>
        <p v-if="editError" class="err-text">{{ editError }}</p>
      </template>
    </BottomSheet>
  </main>
</template>
