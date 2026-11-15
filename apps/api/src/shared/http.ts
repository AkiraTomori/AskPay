import type { Response } from 'express';
import type { z } from 'zod';
import { AppError } from './errors.js';

// Throws VALIDATION_FAILED so handlers never need a try/catch (Express 5 forwards async errors).
export function parseWith<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new AppError('VALIDATION_FAILED', {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return parsed.data;
}

export function sendData(
  res: Response,
  data: unknown,
  status = 200,
  meta?: Record<string, unknown>,
): void {
  res.status(status).json({ data, ...(meta ? { meta } : {}) });
}
