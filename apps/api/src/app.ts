import express, { type Express } from 'express';
import type { Config } from './shared/config.js';
import { errorMiddleware } from './shared/errors.js';
import type { Logger } from './shared/logger.js';
import type { Store } from './shared/store.js';
import { createAskRouter } from './modules/ask/ask.routes.js';
import { createAskService } from './modules/ask/ask.service.js';
import type { PaymentChain } from './modules/payment/payment.chain.js';

export interface AppDeps {
  config: Pick<Config, 'priceUnits' | 'quoteTtlSeconds' | 'rateLimitPerMinute'>;
  store: Store;
  chain: PaymentChain;
  logger: Logger;
  now?: () => number;
  randomSalt?: () => `0x${string}`;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');

  const askService = createAskService({
    store: deps.store,
    chain: deps.chain,
    config: deps.config,
    logger: deps.logger,
    ...(deps.now ? { now: deps.now } : {}),
    ...(deps.randomSalt ? { randomSalt: deps.randomSalt } : {}),
  });
  app.use(
    '/api',
    createAskRouter(askService, { rateLimitPerMinute: deps.config.rateLimitPerMinute }),
  );

  app.use(errorMiddleware(deps.logger));
  return app;
}
