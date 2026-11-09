// Errores que cruzan las capas. La infraestructura traduce sus errores a estos.

/** Sin conexión, timeout o error del servidor (5xx): se puede reintentar. */
export class NetworkError extends Error {
  constructor(message = 'Sin conexión') {
    super(message)
    this.name = 'NetworkError'
  }
}

/** La sesión venció o fue revocada: hay que volver a iniciar sesión (con el mismo usuario). */
export class SessionError extends Error {
  constructor(message = 'Tenés que volver a iniciar sesión') {
    super(message)
    this.name = 'SessionError'
  }
}

export type BusinessCode = 'forbidden' | 'invalid' | 'not_found' | 'conflict' | 'out_of_window' | 'unknown'

/** Regla de negocio rechazada por el servidor: no se reintenta. */
export class BusinessError extends Error {
  constructor(readonly code: BusinessCode, message: string) {
    super(message)
    this.name = 'BusinessError'
  }
}

const CODES: BusinessCode[] = ['forbidden', 'invalid', 'not_found', 'conflict', 'out_of_window']

/** 'invalid: Falta el precio' -> BusinessError('invalid', 'Falta el precio') */
export function businessErrorFromMessage(message: string): BusinessError {
  const m = /^([a-z_]+):\s*(.*)$/s.exec(message)
  if (m && (CODES as string[]).includes(m[1])) return new BusinessError(m[1] as BusinessCode, m[2])
  return new BusinessError('unknown', message)
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}
