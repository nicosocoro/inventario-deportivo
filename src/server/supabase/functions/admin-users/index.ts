// Edge Function admin-users: la única pieza que usa la secret key.
// Acciones: create, reset-password, set-active. Toda regla de permisos/jerarquía la decide SQL,
// llamando a las RPC con el JWT de quien hace el pedido (así queda auditado con su usuario).
//
// Secrets (supabase secrets set ...): SB_SECRET_KEY (secret key nueva). SUPABASE_URL y
// SUPABASE_ANON_KEY / SB_PUBLISHABLE_KEY los provee la plataforma o se cargan igual.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.119.0'

const EMAIL_DOMAIN = 'cadb.local'
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,29}$/
const ROLES = ['venta', 'admin', 'owner']

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

function env(...names: string[]): string {
  for (const n of names) {
    const v = Deno.env.get(n)
    if (v) return v
  }
  throw new Error(`Falta la variable ${names.join(' o ')}`)
}

async function rpc(client: SupabaseClient, fn: string, args: Record<string, unknown>) {
  const { data, error } = await client.rpc(fn, args)
  if (error) throw new HttpError(error.message.startsWith('forbidden') ? 403 : 400, error.message)
  return data
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json(405, { error: 'invalid: Método no permitido' })

  try {
    const url = env('SUPABASE_URL')
    const publishable = env('SB_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY')
    const secret = env('SB_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY')
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    if (!token) throw new HttpError(401, 'forbidden: Falta iniciar sesión')

    const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: who, error: whoError } = await admin.auth.getUser(token)
    if (whoError || !who.user) throw new HttpError(401, 'forbidden: Sesión inválida')

    // Cliente "como el usuario": las RPC ven su auth.uid().
    const asCaller = createClient(url, publishable, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    })

    const body = await req.json().catch(() => ({}))
    switch (body.action) {
      case 'create': {
        const username = String(body.username ?? '').trim().toLowerCase()
        const password = String(body.password ?? '')
        const role = String(body.role ?? '')
        const displayName = body.display_name ? String(body.display_name) : null
        if (!USERNAME_RE.test(username)) throw new HttpError(400, 'invalid: Usuario inválido (3 a 30 letras minúsculas, números, punto o guion)')
        if (password.length < 8) throw new HttpError(400, 'invalid: La contraseña tiene que tener al menos 8 caracteres')
        if (!ROLES.includes(role)) throw new HttpError(400, 'invalid: Rol inválido')
        if (!(await rpc(asCaller, 'can_assign_role', { p_role: role }))) {
          throw new HttpError(403, 'forbidden: No podés crear usuarios con ese rol')
        }
        const { data: existing } = await asCaller.from('profiles').select('id').eq('username', username).maybeSingle()
        if (existing) throw new HttpError(409, 'conflict: Ese nombre de usuario ya existe')

        const { data: created, error } = await admin.auth.admin.createUser({
          email: `${username}@${EMAIL_DOMAIN}`,
          password,
          email_confirm: true,
        })
        if (error || !created.user) throw new HttpError(400, `invalid: ${error?.message ?? 'No se pudo crear el usuario'}`)
        try {
          await rpc(asCaller, 'create_profile', {
            p_user_id: created.user.id,
            p_username: username,
            p_display_name: displayName,
            p_role: role,
          })
        } catch (e) {
          await admin.auth.admin.deleteUser(created.user.id) // rollback
          throw e
        }
        return json(200, { id: created.user.id })
      }

      case 'reset-password': {
        const userId = String(body.user_id ?? '')
        const password = String(body.password ?? '')
        if (password.length < 8) throw new HttpError(400, 'invalid: La contraseña tiene que tener al menos 8 caracteres')
        await rpc(asCaller, 'log_password_reset', { p_user_id: userId }) // valida jerarquía y audita
        const { error } = await admin.auth.admin.updateUserById(userId, { password })
        if (error) throw new HttpError(400, `invalid: ${error.message}`)
        return json(200, { ok: true })
      }

      case 'set-active': {
        const userId = String(body.user_id ?? '')
        const active = Boolean(body.active)
        await rpc(asCaller, 'set_user_active', { p_user_id: userId, p_active: active })
        // Cortar (o devolver) el acceso también en Auth.
        const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: active ? 'none' : '876000h' })
        if (error) throw new HttpError(400, `invalid: ${error.message}`)
        return json(200, { ok: true })
      }

      default:
        throw new HttpError(400, 'invalid: Acción desconocida')
    }
  } catch (e) {
    if (e instanceof HttpError) return json(e.status, { error: e.message })
    console.error(e)
    return json(500, { error: 'Error interno' })
  }
})
