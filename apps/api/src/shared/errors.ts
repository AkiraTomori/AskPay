import type { ErrorRequestHandler } from 'express';
import { ERROR_CODES, type ErrorCode } from '@askpay/shared/errors';
import type { Logger } from './logger.js';

// Services throw this; one middleware turns it into the error envelope (backend.md §3).
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details: unknown;

  constructor(code: ErrorCode, details?: unknown) {
    super(ERROR_CODES[code].message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }

  get httpStatus(): number {
    return ERROR_CODES[this.code].httpStatus;
  }
}

export function errorMiddleware(logger: Logger): ErrorRequestHandler {
  // Express identifies an error handler by its four parameters, so `_next` must stay.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return (error, _req, res, _next) => {
    if (error instanceof AppError) {
      res.status(error.httpStatus).json({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      });
      return;
    }
    // Malformed JSON bodies come from express.json() with a 400 status.
    if (
      typeof error === 'object' &&
      error !== null &&
      'type' in error &&
      error.type === 'entity.parse.failed'
    ) {
      const invalid = new AppError('VALIDATION_FAILED');
      res
        .status(invalid.httpStatus)
        .json({ error: { code: invalid.code, message: invalid.message } });
      return;
    }
    logger.error(
      { err: error instanceof Error ? error.message : String(error) },
      'unhandled error',
    );
    const internal = new AppError('INTERNAL_ERROR');
    res
      .status(internal.httpStatus)
      .json({ error: { code: internal.code, message: internal.message } });
  };
}
