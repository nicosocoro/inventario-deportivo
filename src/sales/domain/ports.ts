import type { Day } from '../../shared/dates'
import type { BalanceReport } from './balance'
import type { RegisterSaleCommand, Sale, VoidSaleCommand } from './sale'
import type { OutboxOp } from './outbox'

export interface SaleRepository {
  /** Idempotente por cmd.id. Lanza NetworkError, SessionError o BusinessError. */
  register(cmd: RegisterSaleCommand): Promise<Sale>
  void(cmd: VoidSaleCommand): Promise<Sale>
  /** Ventas propias de hoy (lo que RLS deja ver a cualquiera). */
  listMineToday(): Promise<Sale[]>
  /** Historial de ventas (requiere history.view o balance.view). */
  listSales(filter: { from: Day; to: Day; onlyFlagged?: boolean }): Promise<Sale[]>
  balance(from: Day, to: Day): Promise<BalanceReport>
  lastSaleDay(): Promise<Day | null>
}

/** Persistencia local de la cola (IndexedDB en el navegador, memoria en tests). */
export interface OutboxStore {
  all(): Promise<OutboxOp[]>
  put(op: OutboxOp): Promise<void>
  remove(id: string): Promise<void>
}

export interface Clock {
  now(): Date
}
