// Utilidades para scripts locales que usan la SECRET key (nunca en el frontend ni commiteada).
import { createClient } from '@supabase/supabase-js'

try {
  process.loadEnvFile('.env')
} catch {
  /* sin .env: usar variables de entorno */
}

export function adminClient() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const secret = process.env.SUPABASE_SECRET_KEY
  if (!url || !secret) {
    console.error('Faltan SUPABASE_URL (o VITE_SUPABASE_URL) y SUPABASE_SECRET_KEY en .env o en el entorno.')
    process.exit(1)
  }
  return createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } })
}

export const EMAIL_DOMAIN = 'cadb.local'
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,29}$/

/** Crea (o reutiliza) un usuario de Auth y su perfil con el rol indicado. */
export async function ensureUser(username: string, password: string, role: 'venta' | 'admin' | 'owner', displayName: string | null) {
  const sb = adminClient()
  username = username.trim().toLowerCase()
  if (!USERNAME_RE.test(username)) throw new Error('Usuario inválido (3 a 30 letras minúsculas, números, punto o guion)')
  if (password.length < 8) throw new Error('La contraseña tiene que tener al menos 8 caracteres')

  const { data: existing } = await sb.from('profiles').select('id,role').eq('username', username).maybeSingle()
  if (existing) {
    console.log(`@${username} ya existe (rol ${existing.role}). No se modificó.`)
    return existing.id as string
  }
  const { data, error } = await sb.auth.admin.createUser({ email: `${username}@${EMAIL_DOMAIN}`, password, email_confirm: true })
  if (error || !data.user) throw new Error(`No se pudo crear en Auth: ${error?.message}`)
  const { error: pErr } = await sb.from('profiles').insert({ id: data.user.id, username, display_name: displayName, role })
  if (pErr) {
    await sb.auth.admin.deleteUser(data.user.id)
    throw new Error(`No se pudo crear el perfil: ${pErr.message}`)
  }
  console.log(`Creado @${username} con rol ${role}.`)
  return data.user.id
}
