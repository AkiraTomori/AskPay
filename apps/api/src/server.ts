import { createApp } from './app.js';
import { createChainClients } from './shared/chain.js';
import { loadConfig } from './shared/config.js';
import { createLogger } from './shared/logger.js';
import { openStore } from './shared/store.js';
import { createTxQueue } from './shared/tx-queue.js';
import { createPaymentChain } from './modules/payment/payment.chain.js';

const logger = createLogger();
const config = loadConfig(process.env);
const store = openStore(config.databasePath);
const clients = createChainClients(config);
const chain = await createPaymentChain(clients, createTxQueue(clients));

const app = createApp({ config, store, chain, logger });
app.listen(config.port, () => {
  // Addresses are public; the key is never logged.
  logger.info(
    { port: config.port, escrow: chain.escrow, provider: clients.account.address },
    'askpay api listening',
  );
});
