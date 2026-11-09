import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { SaleOutbox, mySalesToday } from './outbox'
import type { Clock, SaleRepository } from './ports'
import type { RegisterSaleCommand, Sale, VoidSaleCommand } from './sale'
import { BusinessError, NetworkError, SessionError } from '../../shared/errors'
import { IdbOutboxStore } from '../infra/idb-outbox-store'

class FakeRepo implements SaleRepository {
  calls: string[] = []
  fail: Error | null = null
  sales = new Map<string, Sale>()

  async register(cmd: RegisterSaleCommand): Promise<Sale> {
    this.calls.push(`sale:${cmd.id}`)
    if (this.fail) throw this.fail
    const s: Sale = {
      id: cmd.id, total: cmd.clientTotal, paymentMethod: cmd.payment, cashAmount: cmd.clientTotal, transferAmount: 0,
      transferLast4: null, status: 'ok', flags: [], createdAt: cmd.deviceCreatedAt, createdBy: 'u1', voidedAt: null, voidReason: null,
    }
    this.sales.set(cmd.id, s)
    return s
  }
  async void(cmd: VoidSaleCommand): Promise<Sale> {
    this.calls.push(`void:${cmd.saleId}`)
    if (this.fail) throw this.fail
    const s = this.sales.get(cmd.saleId)
    if (!s) throw new BusinessError('not_found', 'Venta inexistente')
    const v = { ...s, status: 'anulada' as const, voidedAt: cmd.deviceVoidedAt, voidReason: cmd.reason }
    this.sales.set(s.id, v)
    return v
  }
  async listMineToday() { return [...this.sales.values()] }
  async listSales() { return [] }
  async balance(): Promise<never> { throw new Error('no') }
  async lastSaleDay() { return null }
}

const clock: Clock = { now: () => new Date('2026-11-08T18:00:00Z') }
let n = 0
function cmd(): RegisterSaleCommand {
  n++
  return {
    id: `s${n}-${Math.random()}`, items: [{ productId: 'p', name: 'Coca', quantity: 1, shownPrice: 2000 }],
    payment: 'efectivo', transferAmount: null, last4: null, deviceCreatedAt: clock.now().toISOString(), clientTotal: 2000,
  }
}

let repo: FakeRepo
let outbox: SaleOutbox
let store: IdbOutboxStore

beforeEach(async () => {
  repo = new FakeRepo()
  store = new IdbOutboxStore(`test-${Math.random()}`)
  outbox = new SaleOutbox(store, repo, clock)
})

describe('outbox', () => {
  it('sincroniza en orden FIFO: la venta antes que su anulación', async () => {
    const a = await outbox.enqueueSale('u1', cmd())
    await outbox.enqueueVoid('u1', { saleId: a.id, reason: 'error', deviceVoidedAt: clock.now().toISOString() })
    const b = await outbox.enqueueSale('u1', cmd())
    const r = await outbox.sync('u1')
    expect(r).toEqual({ synced: 3, rejected: 0, stopped: null })
    expect(repo.calls).toEqual([`sale:${a.id}`, `void:${a.id}`, `sale:${b.id}`])
    expect(await outbox.pendingFor('u1')).toHaveLength(0)
    // La venta sincronizada queda marcada como anulada.
    const saleOp = (await outbox.all()).find((o) => o.id === a.id)
    expect(saleOp?.result?.status).toBe('anulada')
  })

  it('sin señal corta y deja todo pendiente; al volver la señal reintenta (idempotente)', async () => {
    await outbox.enqueueSale('u1', cmd())
    await outbox.enqueueSale('u1', cmd())
    repo.fail = new NetworkError()
    expect(await outbox.sync('u1')).toMatchObject({ synced: 0, stopped: 'network' })
    expect(await outbox.pendingFor('u1')).toHaveLength(2)
    repo.fail = null
    expect(await outbox.sync('u1')).toMatchObject({ synced: 2, stopped: null })
  })

  it('sesión vencida: corta sin perder nada', async () => {
    await outbox.enqueueSale('u1', cmd())
    repo.fail = new SessionError()
    expect(await outbox.sync('u1')).toMatchObject({ stopped: 'session' })
    expect(await outbox.pendingFor('u1')).toHaveLength(1)
  })

  it('error de negocio: queda rechazada, visible, y sigue con las demás', async () => {
    await outbox.enqueueSale('u1', cmd())
    repo.fail = new BusinessError('forbidden', 'Usuario inactivo')
    expect(await outbox.sync('u1')).toMatchObject({ rejected: 1 })
    const [op] = await outbox.all()
    expect(op.status).toBe('rejected')
    expect(op.error).toBe('Usuario inactivo')
    await outbox.dismiss(op.id)
    expect(await outbox.all()).toHaveLength(0)
  })

  it('solo sincroniza las operaciones del usuario con sesión', async () => {
    await outbox.enqueueSale('u1', cmd())
    await outbox.enqueueSale('u2', cmd())
    expect(await outbox.sync('u2')).toMatchObject({ synced: 1 })
    expect(await outbox.pendingFor('u1')).toHaveLength(1)
  })

  it('no corre dos sincronizaciones a la vez', async () => {
    await outbox.enqueueSale('u1', cmd())
    const [r1, r2] = await Promise.all([outbox.sync('u1'), outbox.sync('u1')])
    expect(r1).toBe(r2)
    expect(repo.calls).toHaveLength(1)
  })

  it('una venta encolada durante un sync en curso se envía en la misma llamada', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const register = repo.register.bind(repo)
    repo.register = async (c) => {
      await gate
      return register(c)
    }
    const a = await outbox.enqueueSale('u1', cmd())
    const p1 = outbox.sync('u1')
    const b = await outbox.enqueueSale('u1', cmd())
    const p2 = outbox.sync('u1')
    expect(p2).toBe(p1)
    release()
    expect(await p2).toEqual({ synced: 2, rejected: 0, stopped: null })
    expect(repo.calls).toEqual([`sale:${a.id}`, `sale:${b.id}`])
    expect(await outbox.pendingFor('u1')).toHaveLength(0)
  })

  it('limpieza: borra lo sincronizado viejo y nunca las rechazadas', async () => {
    let now = new Date('2026-11-08T18:00:00Z')
    const moving: Clock = { now: () => now }
    const ob = new SaleOutbox(store, repo, moving)
    const ok = await ob.enqueueSale('u1', cmd())
    await ob.sync('u1')
    const bad = await ob.enqueueSale('u1', cmd())
    repo.fail = new BusinessError('forbidden', 'Usuario inactivo')
    await ob.sync('u1')
    repo.fail = null
    now = new Date('2026-11-13T18:00:00Z') // 5 días después
    await ob.sync('u1')
    const ids = (await ob.all()).map((o) => o.id)
    expect(ids).not.toContain(ok.id)
    expect(ids).toContain(bad.id)
    await ob.dismiss(bad.id)
    expect(await ob.all()).toHaveLength(0)
  })

  it('"Mis ventas" incluye pendientes de otro día, pero no sincronizadas de otro día', async () => {
    const yesterday = '2026-11-07T18:00:00Z'
    const old = { ...cmd(), deviceCreatedAt: yesterday }
    const oldSynced = { ...cmd(), deviceCreatedAt: yesterday }
    await outbox.enqueueSale('u1', oldSynced)
    await outbox.sync('u1')
    await outbox.enqueueSale('u1', old)
    const rows = mySalesToday(await outbox.all(), [], 'u1', clock.now())
    expect(rows.map((r) => r.id)).toEqual([old.id])
    expect(rows[0]).toMatchObject({ sync: 'pending' })
  })

  it('persiste en IndexedDB entre instancias', async () => {
    await outbox.enqueueSale('u1', cmd())
    const again = new SaleOutbox(store, repo, clock)
    expect(await again.pendingFor('u1')).toHaveLength(1)
  })

  it('"Mis ventas" muestra pendientes, sincronizadas y anulaciones pendientes', async () => {
    const a = await outbox.enqueueSale('u1', cmd())
    await outbox.sync('u1')
    const b = await outbox.enqueueSale('u1', cmd())
    await outbox.enqueueVoid('u1', { saleId: a.id, reason: 'x', deviceVoidedAt: clock.now().toISOString() })
    const rows = mySalesToday(await outbox.all(), await repo.listMineToday(), 'u1', clock.now())
    const ra = rows.find((r) => r.id === a.id)!
    const rb = rows.find((r) => r.id === b.id)!
    expect(ra).toMatchObject({ sync: 'synced', status: 'ok', voidSync: 'pending' })
    expect(rb).toMatchObject({ sync: 'pending', total: 2000, cashAmount: 2000 })
    expect(rb.items).toEqual([{ name: 'Coca', quantity: 1 }])
  })
})
