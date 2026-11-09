import { createStore, del, get, set, clear, type UseStore } from 'idb-keyval'

/** Caché clave/valor en IndexedDB para usar la app sin señal (catálogo, sesión, permisos). */
const store: UseStore | null = typeof indexedDB === 'undefined' ? null : createStore('cadb-cache', 'kv')

export async function cacheGet<T>(key: string): Promise<T | undefined> {
  if (!store) return undefined
  try {
    return await get<T>(key, store)
  } catch {
    return undefined
  }
}

export async function cacheSet(key: string, value: unknown): Promise<void> {
  if (!store) return
  try {
    await set(key, structuredClone(value), store)
  } catch {
    /* sin almacenamiento: la app sigue funcionando online */
  }
}

export async function cacheDel(key: string): Promise<void> {
  if (!store) return
  try {
    await del(key, store)
  } catch {
    /* ignorar */
  }
}

export async function cacheClear(): Promise<void> {
  if (!store) return
  try {
    await clear(store)
  } catch {
    /* ignorar */
  }
}
