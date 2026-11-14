// HTTP only: validate, read the x402 headers, call the service, answer (backend.md §2).
import { Router, json } from 'express';
import { rateLimit } from 'express-rate-limit';
import { askRequestSchema } from '@askpay/shared/api';
import { encodeHeader } from '@askpay/shared/x402';
import { AppError } from '../../shared/errors.js';
import { parseWith, sendData } from '../../shared/http.js';
import type { AskService } from './ask.service.js';

export function createAskRouter(
  service: AskService,
  options: { rateLimitPerMinute: number },
): Router {
  const router = Router();

  // Quotes are free to ask for and cost a row each, so they are limited per IP (api.md §1).
  const limiter = rateLimit({
    windowMs: 60_000,
    limit: options.rateLimitPerMinute,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, _res, next) => next(new AppError('RATE_LIMITED')),
  });

  router.post('/ask', limiter, json({ limit: '16kb' }), async (req, res) => {
    const body = parseWith(askRequestSchema, req.body);
    const paymentHeader = req.header('PAYMENT-SIGNATURE');

    if (paymentHeader === undefined) {
      // First call: no payment yet. The 402 is the x402 body itself, not wrapped in an envelope.
      const quote = service.requestQuote(body.question);
      res.status(402).set('PAYMENT-REQUIRED', encodeHeader(quote)).json(quote);
      return;
    }
    if (!body.qid) throw new AppError('VALIDATION_FAILED');

    const result = await service.submitPayment({
      question: body.question,
      qid: body.qid as `0x${string}`,
      paymentHeader,
    });
    res.set('PAYMENT-RESPONSE', encodeHeader(result.paymentResponse));
    sendData(res, result.body, result.status);
  });

  return router;
}
