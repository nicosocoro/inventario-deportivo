// Usuarios para la demo al club (solo en el proyecto de demo, nunca en producción).
// Uso: npm run create-demo-users   (después correr src/server/supabase/seed-demo.sql en el SQL Editor)
import { ensureUser } from './supabase-admin'

const users = [
  { username: 'demo-venta', password: 'demo-venta-2026', role: 'venta' as const, name: 'Vendedor Demo' },
  { username: 'demo-venta2', password: 'demo-venta-2026', role: 'venta' as const, name: 'Vendedora Demo' },
  { username: 'demo-admin', password: 'demo-admin-2026', role: 'admin' as const, name: 'Admin Demo' },
]

try {
  for (const u of users) await ensureUser(u.username, u.password, u.role, u.name)
  console.log('\nClaves de la demo:')
  for (const u of users) console.log(`  ${u.username} / ${u.password}  (${u.role})`)
} catch (e) {
  console.error((e as Error).message)
  process.exit(1)
}
