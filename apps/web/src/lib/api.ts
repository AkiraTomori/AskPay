import { errorEnvelopeSchema } from '@askpay/shared/api';
import { ERROR_CODES, type ErrorCode } from '@askpay/shared/errors';
import { paymentRequiredSchema, type PaymentRequired } from '@askpay/shared/x402';

// The one API client (frontend convention §2). Same origin: Next rewrites /api/* to apps/api.
// Components and hooks never call fetch; they read this tagged result instead of catching.
export type ApiResult<T> =
  | { kind: 'data'; status: 200 | 202; data: T; headers: Headers }
  // 402 quote: the bare x402 JSON, not wrapped in an envelope. A 402 PAYMENT_INVALID is an `error`.
  | { kind: 'paymentRequired'; body: PaymentRequired; headers: Headers }
  | { kind: 'error'; status: number; code: ErrorCode; message: string; details?: unknown }
  | { kind: 'network'; cause: unknown } // fetch rejected, or the client timeout fired
  | { kind: 'malformed'; status: number }; // the body matches no schema we know

// The structural part of a zod schema that this client needs.
type Schema<T> = {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
};

export type ApiRequest<T> = {
  method?: 'GET' | 'POST';
  body?: unknown;
  headers?: Record<string, string>;
  schema: Schema<T>;
  timeoutMs?: number;
};

export const DEFAULT_TIMEOUT_MS = 15_000;

export async function apiFetch<T>(path: string, request: ApiRequest<T>): Promise<ApiResult<T>> {
  const { method = 'GET', body, headers, schema, timeoutMs = DEFAULT_TIMEOUT_MS } = request;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetch(path, {
        method,
        headers: { ...(body !== undefined && { 'content-type': 'application/json' }), ...headers },
        ...(body !== undefined && { body: JSON.stringify(body) }),
        signal: controller.signal,
      });
    } catch (cause) {
      return { kind: 'network', cause };
    }
    let json: unknown;
    try {
      json = await response.json();
    } catch (cause) {
      // A body that is not JSON (an HTML 502 from a proxy) is malformed. A body that was cut off
      // by the timeout or a dropped connection is a network failure.
      return cause instanceof SyntaxError
        ? { kind: 'malformed', status: response.status }
        : { kind: 'network', cause };
    }
    return interpret(response, json, schema);
  } finally {
    clearTimeout(timer);
  }
}

function interpret<T>(response: Response, json: unknown, schema: Schema<T>): ApiResult<T> {
  const { status, headers } = response;
  if (status === 402) {
    const quote = paymentRequiredSchema.safeParse(json);
    if (quote.success) return { kind: 'paymentRequired', body: quote.data, headers };
  }
  if (status === 200 || status === 202) {
    const data =
      typeof json === 'object' && json !== null
        ? schema.safeParse((json as { data?: unknown }).data)
        : undefined;
    return data?.success
      ? { kind: 'data', status, data: data.data, headers }
      : { kind: 'malformed', status };
  }
  const envelope = errorEnvelopeSchema.safeParse(json);
  if (!envelope.success) return { kind: 'malformed', status };
  const { code, details } = envelope.data.error;
  // The sentence shown comes from the shared table, never from the wire.
  return {
    kind: 'error',
    status,
    code,
    message: ERROR_CODES[code].message,
    ...(details !== undefined && { details }),
  };
}
