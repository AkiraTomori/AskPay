// Writes contracts/deployments/fuji.json from the Foundry broadcast of script/Deploy.s.sol.
// Usage: node scripts/record-deployment.mjs [broadcast-dir] [out-file]
// The deployment file is the single source of truth for the contract address (AGENTS.md).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const dir = process.argv[2] ?? 'contracts/broadcast/Deploy.s.sol/43113';
const out = process.argv[3] ?? 'contracts/deployments/fuji.json';
const run = JSON.parse(readFileSync(`${dir}/run-latest.json`, 'utf8'));
const tx = run.transactions.find(
  (t) => t.transactionType === 'CREATE' && t.contractName === 'AskPayEscrow',
);
if (!tx) throw new Error('no AskPayEscrow CREATE in broadcast');
const receipt = run.receipts.find((r) => r.transactionHash === tx.hash);
if (!receipt || receipt.status !== '0x1') throw new Error('deployment receipt missing or failed');
const [token, provider, checker, answerWindow] = tx.arguments;
const json = {
  chainId: run.chain,
  address: tx.contractAddress,
  deploymentBlock: Number(BigInt(receipt.blockNumber)),
  deployTx: tx.hash,
  deployer: tx.transaction.from,
  token,
  provider,
  checker,
  answerWindow: Number(answerWindow),
};
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(json, null, 2)}\n`);
console.log(`wrote ${out}`, json);
