// Live check of the answer module (A2): real retrieval, real prompt, real LLM, the 10 POC-3
// questions. It runs the code under apps/api/dist, so run `npm run build` first (the npm script does).
//
//   npm run answer:live
//
// Key and model come from `.env.poc` (gitignored): OPENROUTER_API_KEY or GROQ_API_KEY (or
// LLM_API_KEY), and optionally LLM_MODEL / LLM_PROVIDER. Nothing secret is printed. Sends only public law text and the
// sample questions to the provider.
import { readFileSync } from 'node:fs';
import { createAnswerService } from '../apps/api/dist/modules/answer/answer.service.js';
import { createRetrieval } from '../apps/api/dist/modules/retrieval/retrieval.service.js';
import { createLlmClient } from '../apps/api/dist/shared/llm.js';
import { createLogger } from '../apps/api/dist/shared/logger.js';
import { normalizeText } from '../packages/corpus/dist/normalize.js';

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
const answerService = createAnswerService({
  llm: createLlmClient(config),
  logger: createLogger(process.env.LOG_LEVEL ?? 'warn'),
});

const QUESTIONS = [
  ['Thời gian thử việc tối đa với công việc cần bằng cao đẳng là bao lâu?', true],
  ['Làm thêm giờ vào ngày lễ thì được trả lương bao nhiêu phần trăm?', true],
  ['Người lao động được nghỉ phép năm bao nhiêu ngày?', true],
  ['Muốn nghỉ việc thì phải báo trước cho công ty bao nhiêu ngày?', true],
  ['Lao động nữ nghỉ thai sản được bao lâu?', true],
  ['Công ty có được sa thải tôi khi tôi đang nghỉ ốm không?', true],
  ['Mỗi tuần được làm tối đa bao nhiêu giờ?', true],
  ['Hợp đồng lao động có những loại nào?', true],
  ['Cách nấu phở bò ngon tại nhà như thế nào?', false],
  ['Vượt đèn đỏ khi đi xe máy bị phạt bao nhiêu tiền?', false],
];

console.log(`model: ${config.model} (${config.provider})`);
const stats = {
  failed: 0,
  answered: 0,
  noBasisOut: 0,
  outTotal: 0,
  citations: 0,
  verbatim: 0,
  short: 0,
  unknownIds: 0,
};
// Free tiers cap tokens per minute (Groq: 8000, about 4 questions), so a batch needs pacing.
const paceMs = Number(process.env.PACE_MS ?? 0);
for (const [index, [question, inScope]] of QUESTIONS.entries()) {
  if (index > 0 && paceMs > 0) await new Promise((resolve) => setTimeout(resolve, paceMs));
  const candidates = retrieve(question);
  const started = Date.now();
  const outcome = await answerService.answer(question, candidates);
  const ms = Date.now() - started;
  if (outcome.kind === 'failed') {
    stats.failed += 1;
    console.log(`Q${index + 1} FAILED ${ms}ms`);
    continue;
  }
  stats.answered += 1;
  if (!inScope) {
    stats.outTotal += 1;
    if (outcome.noBasis && outcome.citations.length === 0) stats.noBasisOut += 1;
  }
  for (const citation of outcome.citations) {
    const candidate = candidates.find((c) => c.id === citation.candidateId);
    stats.citations += 1;
    if (!candidate) stats.unknownIds += 1;
    else if (normalizeText(candidate.text).includes(citation.quote)) stats.verbatim += 1;
    if (citation.quote.length < 15) stats.short += 1;
  }
  console.log(
    `Q${index + 1} ok ${ms}ms noBasis=${outcome.noBasis} cites=${
      outcome.citations.map((c) => `Đ${c.dieu}${c.khoan ? `.${c.khoan}` : ''}`).join(',') || '-'
    }`,
  );
}
console.log('\nsummary', JSON.stringify(stats));
