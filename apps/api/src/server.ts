import { privateKeyToAccount } from 'viem/accounts';
import { fujiDeployment } from '@askpay/shared/abi';
import { createApp } from './app.js';
import { compose } from './compose.js';
import { createChainClients } from './shared/chain.js';
import { loadConfig } from './shared/config.js';
import { createLlmClient } from './shared/llm.js';
import { createLogger } from './shared/logger.js';
import { openStore } from './shared/store.js';
import { createTxQueue } from './shared/tx-queue.js';
import { DEFAULT_CORPUS_PATH, loadCorpus } from './modules/corpus/corpus.service.js';
import { createPaymentChain } from './modules/payment/payment.chain.js';

const logger = createLogger();
const config = loadConfig(process.env);
const store = openStore(config.databasePath);
const corpus = loadCorpus(config.corpusPath ?? DEFAULT_CORPUS_PATH);
const clients = createChainClients(config);
const checker = privateKeyToAccount(config.checkerPrivateKey);

// Refuses to start unless the escrow's provider and checker are the two keys this process holds and
// its registered corpus root is the one rebuilt here: any mismatch would only show up after a payer
// has paid, as a refund of every question.
const chain = await createPaymentChain(clients, createTxQueue(clients), {
  checker: checker.address,
  lawId: corpus.lawId,
  lawRoot: corpus.root,
});

const { askService, recovery } = compose({
  config,
  store,
  chain,
  logger,
  llm: createLlmClient(config.llm),
  checkerSigner: checker,
  corpus,
  deploymentBlock: BigInt(fujiDeployment.deploymentBlock),
  scanChunk: config.logRangeBlocks,
  lookbackBlocks: config.scanLookbackBlocks,
});

// §5.6 D: reconcile everything with the chain BEFORE taking requests, so the nonce counter starts
// from a settled state and no question with money in escrow is left behind.
await recovery.startup();

const app = createApp({
  askService,
  rateLimitPerMinute: config.rateLimitPerMinute,
  logger,
});
app.listen(config.port, () => {
  recovery.start();
  // Addresses are public; the keys are never logged.
  logger.info(
    {
      port: config.port,
      escrow: chain.escrow,
      provider: clients.account.address,
      checker: checker.address,
    },
    'askpay api listening',
  );
});
