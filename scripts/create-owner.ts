// Crea el owner inicial (una sola vez por proyecto).
// Uso: npm run create-owner -- <usuario> <contraseña> ["Nombre a mostrar"]
import { ensureUser } from './supabase-admin'

const [username, password, displayName] = process.argv.slice(2)
if (!username || !password) {
  console.error('Uso: npm run create-owner -- <usuario> <contraseña> ["Nombre a mostrar"]')
  process.exit(1)
}

try {
  await ensureUser(username, password, 'owner', displayName ?? null)
} catch (e) {
  console.error((e as Error).message)
  process.exit(1)
}
