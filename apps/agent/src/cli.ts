// npm run agent -- --budget 0.20 questions.txt
//
// Reads questions, and for each one asks, signs and pays through the x402 escrow, then prints the
// result (AP-10). The payer key comes only from the environment (E2E_PAYER_PRIVATE_KEY, loaded from
// the gitignored .env.e2e by `node --env-file`). It is never taken from the command line, printed
// or logged. Optional: API_URL (default http://localhost:4000).
//
// Exit codes: 0 the whole list was handled, 2 stopped at the budget cap, 1 stopped on an error or
// a refused quote (or bad usage).
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { fujiDeployment } from '@askpay/shared/abi';
import { REFUND_REASONS, type RefundReasonCode } from '@askpay/shared/errors';
import { formatUsdc } from '@askpay/shared/money';
import type { QuestionResult } from '@askpay/shared/api';
import { privateKeyToAccount } from 'viem/accounts';
import { createBudget, parseBudget } from './budget.js';
import { askAndPay, type AgentSigner, type AskOutcome } from './client.js';

export const DEFAULT_API_URL = 'http://localhost:4000';
const EXPLORER_TX = 'https://testnet.snowscan.xyz/tx';
const DISCLAIMER = 'Thông tin tham khảo, không thay thế tư vấn pháp lý.';
const USAGE = 'usage: npm run agent -- --budget <usdc> <questions.txt | "question" ...>';

export interface CliDeps {
  out: (line: string) => void;
  err: (line: string) => void;
  fetch?: typeof fetch;
  signer?: AgentSigner; // tests only; the real run builds it from the environment
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  rateLimitDelayMs?: number;
}

// What may be echoed of an unknown option: its name only, and nothing at all when the name carries
// a long hex run, so a key glued to dashes (`--0x…`, `-<64 hex>`) never reaches the output.
function optionLabel(arg: string): string {
  const name = arg.split('=')[0] ?? '';
  return /[0-9a-fA-F]{16,}/.test(name) ? '(not shown)' : name.slice(0, 32);
}

type Parsed = { budget: string | undefined; positionals: string[] } | { error: string };

function parseArgs(argv: readonly string[]): Parsed {
  let budget: string | undefined;
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    if (arg === '--budget') budget = argv[++i] ?? '';
    else if (arg.startsWith('--budget=')) budget = arg.slice('--budget='.length);
    // Anything starting with "-" is an option, known or not. Unknown ones are refused before
    // anything else, so a key typed as `--private-key 0x…` or a typo like `-budget 0.2` can never
    // be taken for a question that costs money. Only the option name is echoed, never its value.
    else if (arg.startsWith('-')) return { error: `unknown option ${optionLabel(arg)}` };
    else positionals.push(arg);
  }
  return { budget, positionals };
}

const KEY_SHAPED = /^(0x)?[0-9a-fA-F]{64}$/;
// Anything ending in ".txt" is a file path, spaces included. A missing file is an error, not a
// question that costs money.
const FILE_SHAPED = /\.txt$/i;

function loadQuestions(positionals: readonly string[]): string[] | { error: string } {
  const questions: string[] = [];
  for (const arg of positionals) {
    if (KEY_SHAPED.test(arg.trim())) {
      return {
        error: 'an argument looks like a private key; keys are never passed on the command line',
      };
    }
    if (FILE_SHAPED.test(arg)) {
      if (!existsSync(arg)) return { error: `file not found: ${arg}` };
      for (const line of readFileSync(arg, 'utf8').split(/\r?\n/)) {
        const text = line.trim();
        if (text !== '' && !text.startsWith('#')) questions.push(text);
      }
    } else if (arg.trim() !== '') {
      questions.push(arg.trim());
    }
  }
  return questions;
}

function signerFromEnv(env: NodeJS.ProcessEnv): AgentSigner | { error: string } {
  const raw = env.E2E_PAYER_PRIVATE_KEY?.trim();
  if (!raw) return { error: 'E2E_PAYER_PRIVATE_KEY is not set (put it in .env.e2e)' };
  // Checked here so a malformed value never reaches code that might echo it in an error.
  if (!KEY_SHAPED.test(raw)) {
    return { error: 'E2E_PAYER_PRIVATE_KEY is not a 32-byte hex private key' };
  }
  const account = privateKeyToAccount(raw.startsWith('0x') ? (raw as `0x${string}`) : `0x${raw}`);
  return {
    address: account.address,
    signTypedData: (typedData) => account.signTypedData(typedData),
  };
}

const citationLabel = (c: { dieu: number; khoan: number }) =>
  c.khoan > 0 ? `Đ${c.dieu} K${c.khoan}` : `Đ${c.dieu}`;

function describeResult(result: QuestionResult): string[] {
  const lines: string[] = [];
  if (result.status === 'REFUNDED') {
    const reason = result.reason ? REFUND_REASONS[result.reason as RefundReasonCode] : undefined;
    lines.push(`  Trạng thái: REFUNDED${result.reason ? ` (${result.reason})` : ''}`);
    if (reason) lines.push(`  Lý do: ${reason}`);
  } else {
    lines.push(`  Trạng thái: ${result.status ?? 'chưa rõ'}`);
  }
  if (result.answer) lines.push(`  Trả lời: ${result.answer}`);
  const citations = result.citations ?? [];
  if (citations.length > 0) lines.push(`  Trích dẫn: ${citations.map(citationLabel).join('; ')}`);
  if (result.tx?.deposit) lines.push(`  Tx gửi tiền: ${EXPLORER_TX}/${result.tx.deposit}`);
  if (result.tx?.settle) lines.push(`  Tx chốt: ${EXPLORER_TX}/${result.tx.settle}`);
  return lines;
}

function describeOutcome(outcome: AskOutcome): string[] {
  switch (outcome.kind) {
    case 'settled':
      return describeResult(outcome.result);
    case 'unresolved':
      return [
        `  Trạng thái: CHƯA RÕ${outcome.result?.status ? ` (${outcome.result.status})` : ''}`,
        `  Ghi chú: ${outcome.note}`,
        `  Mã câu hỏi: ${outcome.qid}`,
      ];
    case 'skipped':
      return [`  Bỏ qua: ${outcome.message}`];
    case 'stopped':
      return [`  DỪNG: ${outcome.message}`];
  }
}

export async function runCli(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  deps: CliDeps,
): Promise<number> {
  const { out, err } = deps;
  const fail = (message: string) => {
    err(`ERROR: ${message}`);
    return 1;
  };

  const parsed = parseArgs(argv);
  if ('error' in parsed) return fail(`${parsed.error}\n${USAGE}`);

  let cap: bigint;
  try {
    cap = parseBudget(parsed.budget);
  } catch (error) {
    return fail(`${(error as Error).message}\n${USAGE}`);
  }

  const loaded = loadQuestions(parsed.positionals);
  if ('error' in loaded) return fail(loaded.error);
  if (loaded.length === 0) return fail(`no questions given\n${USAGE}`);
  const questions = loaded;

  const apiUrl = env.API_URL?.trim() || DEFAULT_API_URL;
  try {
    new URL(apiUrl);
  } catch {
    return fail('API_URL is not a valid URL');
  }

  const signer = deps.signer ?? signerFromEnv(env);
  if ('error' in signer) return fail(signer.error);

  const budget = createBudget(cap);
  out(`Ví người hỏi: ${signer.address}`);
  out(`API: ${apiUrl}`);
  out(`Trần ngân sách: ${formatUsdc(cap)} USDC, ${questions.length} câu hỏi`);

  let paid = 0;
  let refunded = 0;
  let skipped = 0;
  let unresolved = 0;
  let stopAt: { index: number; outcome: Extract<AskOutcome, { kind: 'stopped' }> } | undefined;

  for (const [index, question] of questions.entries()) {
    out('');
    out(`[${index + 1}/${questions.length}] ${question}`);
    const outcome = await askAndPay(question, {
      apiUrl,
      fetch: deps.fetch ?? fetch,
      signer,
      budget,
      deployment: fujiDeployment,
      ...(deps.now ? { now: deps.now } : {}),
      ...(deps.sleep ? { sleep: deps.sleep } : {}),
      ...(deps.pollIntervalMs !== undefined ? { pollIntervalMs: deps.pollIntervalMs } : {}),
      ...(deps.pollTimeoutMs !== undefined ? { pollTimeoutMs: deps.pollTimeoutMs } : {}),
      ...(deps.rateLimitDelayMs !== undefined ? { rateLimitDelayMs: deps.rateLimitDelayMs } : {}),
    });
    for (const line of describeOutcome(outcome)) out(line);

    if (outcome.kind === 'settled') {
      if (outcome.result.status === 'PAID') paid++;
      else refunded++;
    } else if (outcome.kind === 'unresolved') unresolved++;
    else if (outcome.kind === 'skipped') skipped++;
    else {
      stopAt = { index, outcome };
      break;
    }
  }

  const notAsked = stopAt ? questions.slice(stopAt.index) : [];
  out('');
  out(`Đã cam kết: ${formatUsdc(budget.committed())} / ${formatUsdc(cap)} USDC`);
  out(
    `Paid: ${paid} · Refunded: ${refunded} · Chưa rõ: ${unresolved} · Bỏ qua: ${skipped} · Chưa hỏi: ${notAsked.length}`,
  );
  if (notAsked.length > 0) {
    out('Các câu chưa hỏi:');
    for (const question of notAsked) out(`  - ${question}`);
  }
  out(DISCLAIMER);

  if (!stopAt) return 0;
  return stopAt.outcome.reason === 'BUDGET' ? 2 : 1;
}

// Only when run as the entry point, never when a test imports this module.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv.slice(2), process.env, {
    out: (line) => console.log(line),
    err: (line) => console.error(line),
  }).then(
    (code) => process.exit(code),
    () => {
      console.error('ERROR: the agent crashed');
      process.exit(1);
    },
  );
}
