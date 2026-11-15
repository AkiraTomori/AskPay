// HTTP only (backend.md §2): the GET endpoints that show what happened (api.md §4 to §8).
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { bytes32Schema, questionListQuerySchema } from '@askpay/shared/api';
import { AppError } from '../../shared/errors.js';
import { parseWith, sendData } from '../../shared/http.js';
import type { AskService } from '../ask/ask.service.js';
import type { HistoryService } from './history.service.js';

export function createHistoryRouter(
  history: HistoryService,
  ask: AskService,
  options: { readRateLimitPerMinute: number },
): Router {
  const router = Router();

  // Every read here can cost an RPC call or a database scan, and the public RPC bans bursts, so a
  // caller is limited per IP before anything runs (backend.md §7). Separate from POST /ask's limit.
  router.use(
    rateLimit({
      windowMs: 60_000,
      limit: options.readRateLimitPerMinute,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      handler: (_req, _res, next) => next(new AppError('RATE_LIMITED')),
    }),
  );

  router.get('/questions/:qid', async (req, res) => {
    // Hex is case-insensitive; the API speaks lower case. A string that is no qid names no question.
    const qid = bytes32Schema.safeParse(req.params.qid.toLowerCase());
    if (!qid.success) throw new AppError('QUESTION_NOT_FOUND');
    sendData(res, await ask.getResult(qid.data));
  });

  router.get('/questions', async (req, res) => {
    const query = parseWith(questionListQuerySchema, req.query);
    const { items, nextCursor } = await history.listQuestions(query);
    sendData(res, items, 200, nextCursor ? { nextCursor } : undefined);
  });

  router.get('/stats', async (_req, res) => {
    sendData(res, await history.stats());
  });

  router.get('/corpus', async (_req, res) => {
    sendData(res, await history.corpusInfo());
  });

  router.get('/health', async (_req, res) => {
    const health = await history.health();
    sendData(res, health, health.rpc === 'down' ? 503 : 200);
  });

  return router;
}
