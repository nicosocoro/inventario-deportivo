import { describe, expect, it } from 'vitest'
import { toDomainError } from './supabase-client'
import { NetworkError, SessionError } from './errors'

describe('toDomainError', () => {
  it('timeout o abort cuentan como falta de señal', () => {
    expect(toDomainError(new DOMException('signal timed out', 'TimeoutError'))).toBeInstanceOf(NetworkError)
    expect(toDomainError(new DOMException('x', 'AbortError'))).toBeInstanceOf(NetworkError)
    expect(toDomainError({ message: 'AbortError: aborted', code: '', status: 0 })).toBeInstanceOf(NetworkError)
  })

  it('401 sigue siendo error de sesión', () => {
    expect(toDomainError({ message: 'JWT expired', code: 'PGRST301', status: 401 })).toBeInstanceOf(SessionError)
  })
})
