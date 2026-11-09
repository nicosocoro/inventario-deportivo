import { BusinessError, NetworkError, SessionError, errorMessage } from '../../shared/errors'
import { addDays, localDay } from '../../shared/dates'
import type { Clock, OutboxStore, SaleRepository } from './ports'
import type { RegisterSaleCommand, Sale, VoidSaleCommand } from './sale'

// Cola única de operaciones de caja (ventas y anulaciones), con y sin señal.
// - Orden FIFO: una venta siempre llega antes que su anulación.
// - Una operación solo se sincroniza con la sesión del usuario que la hizo.
// - Errores de red o de sesión: se corta y se reintenta después. Errores de negocio: "rechazada".
// - En iOS no hay sincronización en segundo plano: la UI llama a sync() al abrir, al volver
//   la señal, al volver a primer plano, cada 30 s y con un botón.

export type OutboxStatus = 'pending' | 'synced' | 'rejected'

interface BaseOp {
  id: string
  seq: number
  userId: string
  createdAt: string
  status: OutboxStatus
  error?: string
  syncedAt?: string
}
export interface SaleOp extends BaseOp {
  kind: 'sale'
  sale: RegisterSaleCommand
  result?: Sale
}
export interface VoidOp extends BaseOp {
  kind: 'void'
  void: VoidSaleCommand
  result?: Sale
}
export type OutboxOp = SaleOp | VoidOp

export interface SyncOutcome {
  synced: number
  rejected: number
  stopped: null | 'network' | 'session'
}

/** Cuántos días se guardan las operaciones ya sincronizadas (las rechazadas se descartan a mano). */
const KEEP_DAYS = 2

export class SaleOutbox {
  private running: Promise<SyncOutcome> | null = null
  /** Se pidió sync mientras corría otro: hace falta una pasada más (pudo haber ventas nuevas). */
  private rerun = false
  private listeners = new Set<() => void>()

  constructor(
    private readonly store: OutboxStore,
    private readonly repo: SaleRepository,
    private readonly clock: Clock,
  ) {}

  onChange(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  private emit() {
    for (const fn of this.listeners) fn()
  }

  async all(): Promise<OutboxOp[]> {
    return (await this.store.all()).sort((a, b) => a.seq - b.seq)
  }

  async pendingFor(userId: string): Promise<OutboxOp[]> {
    return (await this.all()).filter((o) => o.status === 'pending' && o.userId === userId)
  }

  private async nextSeq(): Promise<number> {
    const ops = await this.store.all()
    return ops.reduce((m, o) => Math.max(m, o.seq), 0) + 1
  }

  async enqueueSale(userId: string, sale: RegisterSaleCommand): Promise<SaleOp> {
    const op: SaleOp = {
      id: sale.id,
      seq: await this.nextSeq(),
      userId,
      createdAt: this.clock.now().toISOString(),
      status: 'pending',
      kind: 'sale',
      sale,
    }
    await this.store.put(op)
    this.emit()
    return op
  }

  async enqueueVoid(userId: string, cmd: VoidSaleCommand): Promise<VoidOp> {
    const op: VoidOp = {
      id: `void:${cmd.saleId}`,
      seq: await this.nextSeq(),
      userId,
      createdAt: this.clock.now().toISOString(),
      status: 'pending',
      kind: 'void',
      void: cmd,
    }
    await this.store.put(op)
    this.emit()
    return op
  }

  /**
   * Sincroniza las operaciones pendientes del usuario con sesión. No corre dos veces a la vez:
   * si ya hay una corriendo, devuelve esa misma promesa y le pide una pasada más al terminar,
   * para que también se envíe lo que se encoló mientras tanto.
   */
  sync(currentUserId: string): Promise<SyncOutcome> {
    if (this.running) {
      this.rerun = true
      return this.running
    }
    this.running = this.syncLoop(currentUserId).finally(() => {
      this.running = null
    })
    return this.running
  }

  private async syncLoop(currentUserId: string): Promise<SyncOutcome> {
    this.rerun = false
    const total = await this.doSync(currentUserId)
    // Si una pasada cortó por red o sesión, no se repite: se reintenta con el próximo disparador.
    while (this.rerun && !total.stopped) {
      this.rerun = false
      const r = await this.doSync(currentUserId)
      total.synced += r.synced
      total.rejected += r.rejected
      total.stopped = r.stopped
    }
    this.rerun = false
    return total
  }

  private async doSync(currentUserId: string): Promise<SyncOutcome> {
    const outcome: SyncOutcome = { synced: 0, rejected: 0, stopped: null }
    for (const op of await this.pendingFor(currentUserId)) {
      try {
        if (op.kind === 'sale') {
          op.result = await this.repo.register(op.sale)
        } else {
          op.result = await this.repo.void(op.void)
          await this.attachVoidResult(op.void.saleId, op.result)
        }
        op.status = 'synced'
        op.syncedAt = this.clock.now().toISOString()
        delete op.error
        outcome.synced++
      } catch (e) {
        if (e instanceof NetworkError) {
          outcome.stopped = 'network'
          break
        }
        if (e instanceof SessionError) {
          outcome.stopped = 'session'
          break
        }
        op.status = 'rejected'
        op.error = e instanceof BusinessError ? e.message : errorMessage(e)
        outcome.rejected++
      }
      await this.store.put(op)
      this.emit()
    }
    await this.prune()
    return outcome
  }

  private async attachVoidResult(saleId: string, result: Sale) {
    const saleOp = (await this.store.all()).find((o): o is SaleOp => o.kind === 'sale' && o.id === saleId)
    if (saleOp && saleOp.status === 'synced') {
      saleOp.result = result
      await this.store.put(saleOp)
    }
  }

  /** Borra lo sincronizado de hace más de KEEP_DAYS días. Nunca borra pendientes ni rechazadas (esas se descartan a mano). */
  async prune(): Promise<void> {
    const limit = addDays(localDay(this.clock.now()), -KEEP_DAYS)
    for (const op of await this.store.all()) {
      if (op.status === 'synced' && localDay(op.createdAt) < limit) await this.store.remove(op.id)
    }
  }

  /** Descarta una operación rechazada (después de que un admin la resolvió). */
  async dismiss(id: string): Promise<void> {
    const op = (await this.store.all()).find((o) => o.id === id)
    if (op && op.status === 'rejected') {
      await this.store.remove(id)
      this.emit()
    }
  }
}

// ---------------------------------------------------------------- vista "Mis ventas"

export interface MySaleRow {
  id: string
  createdAt: string
  total: number
  paymentMethod: string
  cashAmount: number
  transferAmount: number
  transferLast4: string | null
  items: { name: string; quantity: number }[]
  /** Estado de la venta respecto del servidor. */
  sync: OutboxStatus
  status: 'ok' | 'anulada'
  /** Estado de la anulación, si se pidió. */
  voidSync: OutboxStatus | null
  flags: string[]
  error?: string
}

/**
 * Une lo que hay en el teléfono con lo que devuelve el servidor (el servidor manda si ya llegó).
 * Incluye las ventas de hoy y, de cualquier día, las que siguen pendientes o fueron rechazadas.
 */
export function mySalesToday(ops: OutboxOp[], server: Sale[], userId: string, now: Date): MySaleRow[] {
  const today = localDay(now)
  const rows = new Map<string, MySaleRow>()
  for (const s of server) {
    if (s.createdBy !== userId || localDay(s.createdAt) !== today) continue
    rows.set(s.id, fromSale(s, 'synced'))
  }
  for (const op of ops) {
    if (op.userId !== userId || op.kind !== 'sale') continue
    // Las pendientes y rechazadas se muestran siempre, aunque sean de otro día (no llegaron al servidor).
    if (op.status === 'synced' && localDay(op.result?.createdAt ?? op.sale.deviceCreatedAt) !== today) continue
    const existing = rows.get(op.id)
    if (existing) {
      if (existing.items.length === 0) existing.items = itemsOf(op)
      continue
    }
    rows.set(op.id, op.result ? { ...fromSale(op.result, op.status), items: itemsOf(op) } : pendingRow(op))
  }
  for (const op of ops) {
    if (op.kind !== 'void' || op.userId !== userId) continue
    const row = rows.get(op.void.saleId)
    if (!row || row.status === 'anulada') continue
    if (op.status === 'synced') {
      row.status = 'anulada'
      row.voidSync = 'synced'
    } else {
      row.voidSync = op.status
      if (op.status === 'rejected') row.error = op.error
    }
  }
  return [...rows.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

function pendingRow(op: SaleOp): MySaleRow {
  const s = op.sale
  const transfer = s.payment === 'transferencia' ? s.clientTotal : s.payment === 'mixto' ? (s.transferAmount ?? 0) : 0
  return {
    id: op.id,
    createdAt: s.deviceCreatedAt,
    total: s.clientTotal,
    paymentMethod: s.payment,
    cashAmount: s.clientTotal - transfer,
    transferAmount: transfer,
    transferLast4: s.last4,
    items: itemsOf(op),
    sync: op.status,
    status: 'ok',
    voidSync: null,
    flags: [],
    error: op.error,
  }
}

function itemsOf(op: SaleOp) {
  return op.sale.items.map((l) => ({ name: l.name, quantity: l.quantity }))
}

function fromSale(s: Sale, sync: OutboxStatus): MySaleRow {
  return {
    id: s.id,
    createdAt: s.createdAt,
    total: s.total,
    paymentMethod: s.paymentMethod,
    cashAmount: s.cashAmount,
    transferAmount: s.transferAmount,
    transferLast4: s.transferLast4,
    items: (s.items ?? []).map((i) => ({ name: i.name, quantity: i.quantity })),
    sync,
    status: s.status,
    voidSync: s.status === 'anulada' ? 'synced' : null,
    flags: s.flags,
  }
}
