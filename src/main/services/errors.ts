import type { AppErrorCode, AppErrorShape } from '../../shared/contracts'

export class AppError extends Error {
  readonly code: AppErrorCode
  readonly details?: unknown

  constructor(code: AppErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.details = details
  }

  toShape(): AppErrorShape {
    return { code: this.code, message: this.message, details: this.details }
  }
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error
  return new AppError('INTERNAL_ERROR', error instanceof Error ? error.message : 'Unexpected error')
}
