// Detección de plataforma y de app instalada (iOS se trata como objetivo principal).

export function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

/** Pide almacenamiento persistente (Safari 17+ lo concede por heurísticas, p. ej. app instalada). */
export async function requestPersistentStorage(): Promise<boolean | null> {
  if (!navigator.storage?.persist) return null
  try {
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch {
    return null
  }
}

export async function isPersisted(): Promise<boolean | null> {
  if (!navigator.storage?.persisted) return null
  try {
    return await navigator.storage.persisted()
  } catch {
    return null
  }
}

/** Mantener la pantalla encendida en la caja (opcional; en iOS instalada funciona desde 18.4). */
export async function keepScreenOn(): Promise<(() => void) | null> {
  const wl = (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock
  if (!wl) return null
  try {
    const lock = await wl.request('screen')
    return () => void lock.release().catch(() => {})
  } catch {
    return null
  }
}
