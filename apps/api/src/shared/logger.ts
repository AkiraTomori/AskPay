import { pino } from 'pino';

// Keys are redacted even if one slips into a log object. Questions are never logged at info level
// (backend.md §5): log the qid and the length instead.
export function createLogger(level = process.env.LOG_LEVEL ?? 'info') {
  return pino({
    level,
    redact: {
      paths: [
        '*.apiKey',
        'apiKey',
        '*.privateKey',
        '*.providerPrivateKey',
        'providerPrivateKey',
        'privateKey',
        'req.headers["payment-signature"]',
      ],
      censor: '[redacted]',
    },
  });
}

export type Logger = ReturnType<typeof createLogger>;
