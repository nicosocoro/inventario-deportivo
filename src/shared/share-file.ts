// Entrega de archivos en el teléfono:
// 1) hoja de compartir (WhatsApp, Drive, Imprimir) si el navegador acepta archivos;
// 2) descarga;
// 3) en iOS sin hoja de compartir para archivos, abrir en una pestaña nueva (desde ahí se comparte
//    o guarda en Archivos).
// Safari exige que share() se llame dentro del toque del usuario: no hacer awaits antes de llamar
// a esta función. Si igual lo rechaza (NotAllowedError) se devuelve 'blocked' para que la UI pida
// tocar de nuevo (window.open también estaría bloqueado).

export type ShareResult = 'shared' | 'downloaded' | 'opened' | 'cancelled' | 'blocked'

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

export async function shareOrDownload(blob: Blob, filename: string, title: string): Promise<ShareResult> {
  const file = new File([blob], filename, { type: blob.type })
  const canShareFiles = typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })
  if (canShareFiles) {
    try {
      await navigator.share({ files: [file], title })
      return 'shared'
    } catch (e) {
      const name = (e as DOMException).name
      if (name === 'AbortError') return 'cancelled'
      if (name === 'NotAllowedError') return 'blocked'
      // Si falla por otro motivo, seguir con la descarga.
    }
  }
  const url = URL.createObjectURL(blob)
  try {
    if (isIos() && !canShareFiles) {
      window.open(url, '_blank')
      return 'opened'
    }
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    return 'downloaded'
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
}
