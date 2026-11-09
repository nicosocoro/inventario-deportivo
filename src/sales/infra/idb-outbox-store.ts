import { createStore, del, entries, set, type UseStore } from 'idb-keyval'
import type { OutboxStore } from '../domain/ports'
import type { OutboxOp } from '../domain/outbox'

/** Cola de ventas en IndexedDB (sobrevive a cerrar la app y a quedarse sin señal). */
export class IdbOutboxStore implements OutboxStore {
  private readonly db: UseStore

  constructor(dbName = 'cadb-outbox') {
    this.db = createStore(dbName, 'ops')
  }

  async all(): Promise<OutboxOp[]> {
    return (await entries<string, OutboxOp>(this.db)).map(([, v]) => v)
  }

  async put(op: OutboxOp): Promise<void> {
    await set(op.id, structuredClone(op), this.db)
  }

  async remove(id: string): Promise<void> {
    await del(id, this.db)
  }
}
