import express, { type Express } from 'express';
import { errorMiddleware } from './shared/errors.js';
import type { Logger } from './shared/logger.js';
import { createAskRouter } from './modules/ask/ask.routes.js';
import type { AskService } from './modules/ask/ask.service.js';
import { createHistoryRouter } from './modules/history/history.routes.js';
import type { HistoryService } from './modules/history/history.service.js';

export interface AppDeps {
  askService: AskService;
  historyService: HistoryService;
  rateLimitPerMinute: number;
  readRateLimitPerMinute: number;
  // Reverse proxies in front of the server; 0 when there is none (Config.trustProxyHops).
  trustProxyHops?: number;
  logger: Logger;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  // Without this, behind a proxy every caller has the proxy's IP and shares one rate limit.
  if (deps.trustProxyHops) app.set('trust proxy', deps.trustProxyHops);
  app.use(
    '/api',
    createAskRouter(deps.askService, { rateLimitPerMinute: deps.rateLimitPerMinute }),
  );
  app.use(
    '/api',
    createHistoryRouter(deps.historyService, deps.askService, {
      readRateLimitPerMinute: deps.readRateLimitPerMinute,
    }),
  );
  app.use(errorMiddleware(deps.logger));
  return app;
}
