// Base de datos de prueba: Postgres real (PGlite, WASM) con las migraciones del proyecto y un
// stub mínimo de lo que Supabase provee (schema auth, auth.uid(), roles anon/authenticated).
// No necesita Docker. Para probar contra Supabase local real: `npm run db:start`.
import { PGlite } from '@electric-sql/pglite'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const MIGRATIONS_DIR = join(import.meta.dirname, '..', 'supabase', 'migrations')

const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text unique);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
`

export type Role = 'venta' | 'admin' | 'owner'

export class TestDb {
  private constructor(readonly pg: PGlite) {}

  static async create(): Promise<TestDb> {
    const pg = new PGlite()
    await pg.exec(SUPABASE_STUB)
    for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
      await pg.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'))
    }
    return new TestDb(pg)
  }

  /** Crea un usuario de Auth + perfil directamente (como el script create-owner). */
  async createUser(username: string, role: Role): Promise<string> {
    await this.asSuper()
    const id = randomUUID()
    await this.pg.query('insert into auth.users (id, email) values ($1, $2)', [id, `${username}@cadb.local`])
    await this.pg.query('insert into public.profiles (id, username, role) values ($1, $2, $3)', [id, username, role])
    return id
  }

  async createAuthOnly(username: string): Promise<string> {
    await this.asSuper()
    const id = randomUUID()
    await this.pg.query('insert into auth.users (id, email) values ($1, $2)', [id, `${username}@cadb.local`])
    return id
  }

  async as(userId: string): Promise<void> {
    await this.pg.query('reset role')
    await this.pg.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: userId, role: 'authenticated' })])
    await this.pg.query('set role authenticated')
  }

  async asAnon(): Promise<void> {
    await this.pg.query('reset role')
    await this.pg.query(`select set_config('request.jwt.claims', '', false)`)
    await this.pg.query('set role anon')
  }

  async asSuper(): Promise<void> {
    await this.pg.query('reset role')
    await this.pg.query(`select set_config('request.jwt.claims', '', false)`)
  }

  async rows<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const res = await this.pg.query<T>(sql, params)
    return res.rows
  }

  async one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
    const rows = await this.rows<T>(sql, params)
    if (rows.length !== 1) throw new Error(`Se esperaba 1 fila, hubo ${rows.length}`)
    return rows[0]
  }

  /** Llama una función y devuelve su resultado (columna r). */
  async call<T = unknown>(fn: string, args: unknown[] = [], casts: string[] = []): Promise<T> {
    const placeholders = args.map((_, i) => `$${i + 1}${casts[i] ? `::${casts[i]}` : ''}`).join(', ')
    const row = await this.one<{ r: T }>(`select public.${fn}(${placeholders}) as r`, args)
    return row.r
  }

  /** Ejecuta y devuelve el mensaje de error (o falla si no hubo error). */
  async error(sql: string, params: unknown[] = []): Promise<string> {
    try {
      await this.pg.query(sql, params)
    } catch (e) {
      return (e as Error).message
    }
    throw new Error(`Se esperaba un error: ${sql}`)
  }

  async callError(fn: string, args: unknown[] = [], casts: string[] = []): Promise<string> {
    const placeholders = args.map((_, i) => `$${i + 1}${casts[i] ? `::${casts[i]}` : ''}`).join(', ')
    return this.error(`select public.${fn}(${placeholders})`, args)
  }
}
