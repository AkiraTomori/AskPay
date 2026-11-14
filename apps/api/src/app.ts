import express, { type Express } from 'express';
import { errorMiddleware } from './shared/errors.js';
import type { Logger } from './shared/logger.js';
import { createAskRouter } from './modules/ask/ask.routes.js';
import type { AskService } from './modules/ask/ask.service.js';

export interface AppDeps {
  askService: AskService;
  rateLimitPerMinute: number;
  logger: Logger;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(
    '/api',
    createAskRouter(deps.askService, { rateLimitPerMinute: deps.rateLimitPerMinute }),
  );
  app.use(errorMiddleware(deps.logger));
  return app;
}
