// Live check of the checker (A3): real corpus, real answer step, real LLM judge (C4). The signing
// key is a throwaway generated here, so nothing secret is needed beyond the LLM key. It runs the
// code under apps/api/dist, so run `npm run build` first (the npm script does).
//
//   npm run check:live
//
// Key and model come from `.env.poc` (gitignored), like answer:live. Sends only public law text and
// the sample questions to the provider. Two checks:
//   1. in-scope questions: the answer step's output should pass C2, C3 and C4;
//   2. controls: the same question paired with a verbatim quote from an UNRELATED Khoản. C2 and C3
//      pass, so only the judge can reject it (C4). A judge that says "yes" to these is useless.
import { readFileSync } from 'node:fs';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createAnswerService } from '../apps/api/dist/modules/answer/answer.service.js';
import { createCheckerService } from '../apps/api/dist/modules/checker/checker.service.js';
import { createRetrieval } from '../apps/api/dist/modules/retrieval/retrieval.service.js';
import { createLlmClient } from '../apps/api/dist/shared/llm.js';
import { createLogger } from '../apps/api/dist/shared/logger.js';
import { normalizeText } from '../packages/corpus/dist/normalize.js';
import { BLLD_2019_LAW_ID, hashText } from '../packages/shared/dist/leaf.js';
import { fujiDeployment } from '../packages/shared/dist/abi/deployments.js';

const provider = process.env.LLM_PROVIDER ?? 'openrouter';
const apiKey = (
  process.env.LLM_API_KEY ??
  (provider === 'groq' ? process.env.GROQ_API_KEY : process.env.OPENROUTER_API_KEY) ??
  ''
).trim();
if (!apiKey) {
  console.error('ERROR: set LLM_API_KEY, or OPENROUTER_API_KEY / GROQ_API_KEY, in .env.poc');
  process.exit(1);
}
const config = {
  provider,
  apiKey,
  model: process.env.LLM_MODEL ?? 'inclusionai/ling-3.2-flash:free',
  jsonMode: process.env.LLM_JSON_MODE !== 'false',
};

const corpus = JSON.parse(readFileSync('packages/corpus/data/blld-2019.khoan.json', 'utf8')).map(
  (k) => ({
    dieu: Number(k.dieu),
    khoan: Number(k.khoan),
    dieuTitle: k.dieuTitle,
    text: k.text,
  }),
);
const retrieve = createRetrieval(corpus);
const llm = createLlmClient(config);
const logger = createLogger(process.env.LOG_LEVEL ?? 'warn');
const answerService = createAnswerService({ llm, logger });
const account = privateKeyToAccount(generatePrivateKey());
const checkerService = createCheckerService({
  llm,
  logger,
  signer: account,
  escrow: fujiDeployment.address,
  corpus,
});

const QUESTIONS = [
  'Thời gian thử việc tối đa với công việc cần bằng cao đẳng là bao lâu?',
  'Làm thêm giờ vào ngày lễ thì được trả lương bao nhiêu phần trăm?',
  'Người lao động được nghỉ phép năm bao nhiêu ngày?',
  'Muốn nghỉ việc thì phải báo trước cho công ty bao nhiêu ngày?',
  'Lao động nữ nghỉ thai sản được bao lâu?',
  'Công ty có được sa thải tôi khi tôi đang nghỉ ốm không?',
  'Mỗi tuần được làm tối đa bao nhiêu giờ?',
  'Hợp đồng lao động có những loại nào?',
];

const paceMs = Number(process.env.PACE_MS ?? 0);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const textOf = (dieu, khoan) =>
  corpus.find((k) => k.dieu === dieu && k.khoan === khoan)?.text ?? '';
const toCheck = (qid, question, answer, citations) => ({
  qid,
  question,
  answer,
  citations: citations.map((c) => ({
    lawId: BLLD_2019_LAW_ID,
    dieu: c.dieu,
    khoan: c.khoan,
    textHash: hashText(normalizeText(textOf(c.dieu, c.khoan))),
    quote: c.quote,
  })),
});

const stats = { positives: 0, passed: 0, rejected: 0, failed: 0, noCitation: 0 };
const controls = { total: 0, rejectedAtC4: 0, passed: 0, failed: 0, otherReject: 0 };
const answered = [];

console.log(`model: ${config.model} (${config.provider}), checker ${account.address}`);
for (const [index, question] of QUESTIONS.entries()) {
  if (index > 0 && paceMs > 0) await sleep(paceMs);
  const outcome = await answerService.answer(question, retrieve(question));
  if (outcome.kind !== 'answered' || outcome.noBasis) {
    console.log(`Q${index + 1} answer step gave nothing to check`);
    continue;
  }
  answered.push({ question, outcome });
  stats.positives += 1;
  const qid = hashText(`live-${index}`);
  const started = Date.now();
  const verdict = await checkerService.check(
    toCheck(qid, question, outcome.answer, outcome.citations),
  );
  const ms = Date.now() - started;
  if (verdict.kind === 'no-citation') stats.noCitation += 1;
  else if (verdict.kind === 'failed') stats.failed += 1;
  else if (verdict.pass) stats.passed += 1;
  else stats.rejected += 1;
  console.log(
    `Q${index + 1} ${verdict.kind}${verdict.kind === 'signed' ? ` pass=${verdict.pass}${verdict.rejectedAt ? ` at ${verdict.rejectedAt}` : ''}` : ''} ${ms}ms`,
  );
}

// Controls: answer i's question, but the citation is a verbatim quote of another answer's Khoản.
for (const [index, item] of answered.entries()) {
  const other = answered[(index + 3) % answered.length];
  const wrong = other?.outcome.citations[0];
  if (
    !wrong ||
    (wrong.dieu === item.outcome.citations[0]?.dieu &&
      wrong.khoan === item.outcome.citations[0]?.khoan)
  )
    continue;
  if (paceMs > 0) await sleep(paceMs / 4);
  controls.total += 1;
  const verdict = await checkerService.check(
    toCheck(hashText(`control-${index}`), item.question, `Theo Điều ${wrong.dieu}.`, [wrong]),
  );
  if (verdict.kind === 'failed') controls.failed += 1;
  else if (verdict.kind === 'signed' && verdict.pass) controls.passed += 1;
  else if (verdict.kind === 'signed' && verdict.rejectedAt === 'C4') controls.rejectedAtC4 += 1;
  else controls.otherReject += 1;
  console.log(
    `control ${index + 1}: Đ${wrong.dieu}.${wrong.khoan} for "${item.question.slice(0, 40)}…" -> ${
      verdict.kind === 'signed' ? `pass=${verdict.pass} ${verdict.rejectedAt ?? ''}` : verdict.kind
    }`,
  );
}
console.log('\npositives', JSON.stringify(stats));
console.log('controls', JSON.stringify(controls));
