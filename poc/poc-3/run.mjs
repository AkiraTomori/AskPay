// POC-3: does a free OpenRouter model return Vietnamese JSON in the answer schema (system-design
// §5.3) and cite only the candidate ids it was given? Pass bar (poc-results.md):
//   >= 9/10 questions with valid JSON, and 0 citations of an id outside the candidate list.
//
// The prompt is built the way the answer module will build it: real BM25 retrieval over the real
// corpus, top 8 candidates C1..C8. Only public law text and sample questions leave this machine.
//
//   npm run build   # tsc --build, so the retrieval module exists in dist
//   node --env-file=.env.poc poc/poc-3/run.mjs --model google/gemma-4-31b-it:free
//   node --env-file=.env.poc poc/poc-3/run.mjs --provider groq --list-models   # ids Groq offers
//   node --env-file=.env.poc poc/poc-3/run.mjs --provider groq --model <id>
//   node poc/poc-3/run.mjs --dry                      # no network: show prompts and retrieval only
//
// Keys (OPENROUTER_API_KEY, GROQ_API_KEY) come only from `.env.poc` (gitignored) and are never
// printed or written.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { createRetrieval } from '../../apps/api/dist/modules/retrieval/retrieval.service.js';
import { normalizeText } from '../../packages/corpus/dist/normalize.js';

const PROVIDERS = {
  openrouter: { api: 'https://openrouter.ai/api/v1', keyEnv: 'OPENROUTER_API_KEY' },
  groq: { api: 'https://api.groq.com/openai/v1', keyEnv: 'GROQ_API_KEY' },
};
const providerName = process.argv.includes('--provider')
  ? process.argv[process.argv.indexOf('--provider') + 1]
  : 'openrouter';
const provider = PROVIDERS[providerName];
if (!provider) {
  console.error(`ERROR: unknown --provider ${providerName} (use openrouter or groq)`);
  process.exit(1);
}
const API = provider.api;
const MIN_QUOTE_LENGTH = 15; // checker C2 (system-design §5.4)
const LLM_TIMEOUT_MS = 60_000; // measured, not enforced: the design budget is 20 s per call
const DESIGN_BUDGET_MS = 20_000;

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const models = args.flatMap((arg, i) => (arg === '--model' ? [args[i + 1]] : []));
const only = args.includes('--only') ? Number(args[args.indexOf('--only') + 1]) : undefined;

// --- Sample questions: 8 the law answers, 2 it does not (AP-04-AC03). -------------------------
const QUESTIONS = [
  { q: 'Thời gian thử việc tối đa với công việc cần bằng cao đẳng là bao lâu?', inScope: true },
  { q: 'Làm thêm giờ vào ngày lễ thì được trả lương bao nhiêu phần trăm?', inScope: true },
  { q: 'Người lao động được nghỉ phép năm bao nhiêu ngày?', inScope: true },
  { q: 'Muốn nghỉ việc thì phải báo trước cho công ty bao nhiêu ngày?', inScope: true },
  { q: 'Lao động nữ nghỉ thai sản được bao lâu?', inScope: true },
  { q: 'Công ty có được sa thải tôi khi tôi đang nghỉ ốm không?', inScope: true },
  { q: 'Mỗi tuần được làm tối đa bao nhiêu giờ?', inScope: true },
  { q: 'Hợp đồng lao động có những loại nào?', inScope: true },
  { q: 'Cách nấu phở bò ngon tại nhà như thế nào?', inScope: false },
  { q: 'Vượt đèn đỏ khi đi xe máy bị phạt bao nhiêu tiền?', inScope: false },
];

// --- Corpus and retrieval ---------------------------------------------------------------------
const corpus = JSON.parse(readFileSync('packages/corpus/data/blld-2019.khoan.json', 'utf8')).map(
  (k) => ({
    dieu: Number(k.dieu),
    khoan: Number(k.khoan),
    dieuTitle: k.dieuTitle,
    text: k.text,
  }),
);
const retrieve = createRetrieval(corpus);

// --- Prompt (system-design §5.3) --------------------------------------------------------------
const SYSTEM = [
  'Bạn là trợ lý chỉ trả lời theo Bộ luật Lao động 2019 của Việt Nam.',
  'Chỉ dùng các ứng viên được cung cấp. Không dùng kiến thức bên ngoài và không bịa số Điều.',
  'Trả về DUY NHẤT một đối tượng JSON, không có chữ nào ngoài JSON, theo dạng:',
  '{"noBasis": boolean, "answer": string, "citations": [{"candidateId": "C1", "quote": string}]}',
  '- noBasis=true nếu không ứng viên nào trả lời được câu hỏi; khi đó citations phải là [] .',
  '- answer: tiếng Việt, tối đa 1200 ký tự.',
  '- citations: 0 đến 5 mục. candidateId CHỈ được là một ID trong danh sách ứng viên (C1…C8).',
  '- quote: chép NGUYÊN VĂN một đoạn liên tiếp từ văn bản của ứng viên đó, dài ít nhất 15 ký tự.',
].join('\n');

function buildUser(question, candidates) {
  const list = candidates
    .map(
      (c) =>
        `[${c.id}] Điều ${c.dieu}${c.khoan ? ` Khoản ${c.khoan}` : ''} (${c.dieuTitle}): ${c.text}`,
    )
    .join('\n\n');
  return `Câu hỏi: ${question}\n\nCác ứng viên:\n${list}`;
}

// --- Output schema ----------------------------------------------------------------------------
const outputSchema = z.object({
  noBasis: z.boolean(),
  answer: z.string().max(1200),
  citations: z.array(z.object({ candidateId: z.string(), quote: z.string() })).max(5),
});

// Models often wrap JSON in ```json fences or add a sentence; take the outermost braces.
function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

// --- OpenRouter -------------------------------------------------------------------------------
const apiKey = process.env[provider.keyEnv]?.trim();

async function chat(model, userPrompt, supportsJsonMode) {
  const body = {
    model,
    temperature: 0,
    max_tokens: 2000, // reasoning models spend part of this before the JSON
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: userPrompt },
    ],
    ...(supportsJsonMode ? { response_format: { type: 'json_object' } } : {}),
  };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const started = Date.now();
    const response = await fetch(`${API}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    }).catch((error) => ({ networkError: String(error.name ?? error) }));
    const ms = Date.now() - started;
    if ('networkError' in response) return { ok: false, ms, error: response.networkError };
    if (response.status === 429) {
      const text = await response.text();
      if (/per-day|daily/i.test(text)) return { ok: false, ms, error: 'DAILY_LIMIT', stop: true };
      // Honour the provider's own wait if it gives one; free tiers allow only a few requests a minute.
      const waitSeconds = Number(response.headers.get('retry-after'));
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          Number.isFinite(waitSeconds) && waitSeconds > 0
            ? Math.min(waitSeconds, 60) * 1000
            : 15_000,
        ),
      );
      continue;
    }
    const json = await response.json().catch(() => undefined);
    // OpenRouter sends the headers early and the body when the model finishes, so the latency that
    // matters is measured here, after the body is read (the first POC-3 run measured too early).
    const totalMs = Date.now() - started;
    if (!response.ok) {
      return {
        ok: false,
        ms: totalMs,
        error: `HTTP ${response.status} ${String(json?.error?.message ?? '').slice(0, 120)}`,
      };
    }
    const content = json?.choices?.[0]?.message?.content;
    return typeof content === 'string' && content.length > 0
      ? { ok: true, ms: totalMs, content }
      : { ok: false, ms: totalMs, error: 'EMPTY_CONTENT' };
  }
  return { ok: false, ms: 0, error: 'RATE_LIMITED' };
}

// --- Per-question evaluation ------------------------------------------------------------------
function evaluate(content, candidates) {
  const raw = extractJson(content);
  if (raw === undefined) return { jsonValid: false, reason: 'NOT_JSON' };
  const parsed = outputSchema.safeParse(raw);
  if (!parsed.success) return { jsonValid: false, reason: 'SCHEMA' };

  const ids = new Set(candidates.map((c) => c.id));
  const foreignIds = parsed.data.citations
    .filter((c) => !ids.has(c.candidateId))
    .map((c) => c.candidateId);
  // Informative for the checker (C2): is the quote really a substring of the Khoản it names?
  const quotes = parsed.data.citations.flatMap((c) => {
    const candidate = candidates.find((x) => x.id === c.candidateId);
    if (!candidate) return [];
    const quote = normalizeText(c.quote);
    return [
      { ok: quote.length >= MIN_QUOTE_LENGTH && normalizeText(candidate.text).includes(quote) },
    ];
  });
  return {
    jsonValid: true,
    noBasis: parsed.data.noBasis,
    citationCount: parsed.data.citations.length,
    foreignIds,
    quotesChecked: quotes.length,
    quotesVerbatim: quotes.filter((x) => x.ok).length,
    noBasisWithCitations: parsed.data.noBasis && parsed.data.citations.length > 0,
    // Kept so a human can judge the Vietnamese and whether the cited Khoản answers the question.
    answer: parsed.data.answer,
    cited: parsed.data.citations.map((c) => {
      const candidate = candidates.find((x) => x.id === c.candidateId);
      return {
        where: candidate
          ? `Điều ${candidate.dieu}${candidate.khoan ? ` Khoản ${candidate.khoan}` : ''}`
          : c.candidateId,
        quote: c.quote,
      };
    }),
  };
}

async function runModel(model, supportsJsonMode) {
  const rows = [];
  for (const [index, item] of QUESTIONS.entries()) {
    if (only !== undefined && index !== only) continue;
    const candidates = retrieve(item.q);
    const userPrompt = buildUser(item.q, candidates);
    let result = await chat(model, userPrompt, supportsJsonMode);
    if (result.stop) return { rows, stopped: result.error };
    let evaluation = result.ok
      ? evaluate(result.content, candidates)
      : { jsonValid: false, reason: result.error };
    const firstTryValid = evaluation.jsonValid;
    let retried = false;
    if (!evaluation.jsonValid) {
      // Design: a parse failure gets exactly one retry (system-design §5.3).
      retried = true;
      result = await chat(model, userPrompt, supportsJsonMode);
      if (result.stop) return { rows, stopped: result.error };
      evaluation = result.ok
        ? evaluate(result.content, candidates)
        : { jsonValid: false, reason: result.error };
    }
    rows.push({
      index,
      question: item.q,
      inScope: item.inScope,
      ms: result.ms,
      firstTryValid,
      retried,
      ...evaluation,
    });
    const flag = evaluation.jsonValid ? 'ok ' : 'BAD';
    console.log(
      `  ${flag} Q${index + 1} ${result.ms}ms` +
        (evaluation.jsonValid
          ? ` noBasis=${evaluation.noBasis} cites=${evaluation.citationCount} foreign=${evaluation.foreignIds.length} verbatim=${evaluation.quotesVerbatim}/${evaluation.quotesChecked}`
          : ` ${evaluation.reason}`),
    );
  }
  return { rows };
}

function summarise(model, rows) {
  const n = rows.length;
  const valid = rows.filter((r) => r.jsonValid);
  const inScope = valid.filter((r) => r.inScope);
  const outScope = valid.filter((r) => !r.inScope);
  const quotesChecked = valid.reduce((sum, r) => sum + r.quotesChecked, 0);
  const quotesVerbatim = valid.reduce((sum, r) => sum + r.quotesVerbatim, 0);
  const summary = {
    model,
    questions: n,
    validFirstTry: rows.filter((r) => r.firstTryValid).length,
    validAfterRetry: valid.length,
    foreignIds: valid.reduce((sum, r) => sum + r.foreignIds.length, 0),
    outOfScopeNoBasis: `${outScope.filter((r) => r.noBasis).length}/${outScope.length}`,
    inScopeAnswered: `${inScope.filter((r) => !r.noBasis && r.citationCount > 0).length}/${inScope.length}`,
    noBasisWithCitations: valid.filter((r) => r.noBasisWithCitations).length,
    quotesVerbatim: `${quotesVerbatim}/${quotesChecked}`,
    slowerThanBudget: rows.filter((r) => r.ms > DESIGN_BUDGET_MS).length,
    medianMs: rows.map((r) => r.ms).sort((a, b) => a - b)[Math.floor(n / 2)],
  };
  // The pass bar from poc-results.md.
  summary.pass = n >= 10 && summary.validAfterRetry >= 9 && summary.foreignIds === 0;
  return summary;
}

// --- Main -------------------------------------------------------------------------------------
if (dry) {
  for (const [index, item] of QUESTIONS.entries()) {
    const hits = retrieve(item.q).map((c) => `${c.id}=Đ${c.dieu}${c.khoan ? `.${c.khoan}` : ''}`);
    console.log(`Q${index + 1} (${item.inScope ? 'in' : 'out'}) top-8: ${hits.join(' ')}`);
  }
  const sample = retrieve(QUESTIONS[0].q);
  console.log(
    `\nprompt size for Q1: system ${SYSTEM.length} + user ${buildUser(QUESTIONS[0].q, sample).length} chars`,
  );
  process.exit(0);
}
if (!apiKey) {
  console.error(
    `ERROR: ${provider.keyEnv} is not set (put it in .env.poc and use node --env-file=.env.poc)`,
  );
  process.exit(1);
}
if (models.length === 0 && !args.includes('--list-models')) {
  console.error('ERROR: pass at least one --model <id>');
  process.exit(1);
}

// Capabilities come from OpenRouter's public model list, not from guesswork.
const catalogueResponse = await fetch(`${API}/models`, {
  headers: providerName === 'groq' ? { Authorization: `Bearer ${apiKey}` } : {},
});
if (!catalogueResponse.ok) {
  console.error(`ERROR: model list failed with HTTP ${catalogueResponse.status}`);
  process.exit(1);
}
const catalogue = (await catalogueResponse.json()).data;
if (args.includes('--list-models')) {
  for (const m of catalogue) console.log(m.id);
  process.exit(0);
}
mkdirSync('poc/poc-3/results', { recursive: true });
const summaries = [];
for (const model of models) {
  const info = catalogue.find((m) => m.id === model);
  if (!info) {
    console.error(`unknown model ${model}`);
    continue;
  }
  // OpenRouter lists supported parameters; Groq's chat models accept JSON mode without listing it.
  const supportsJsonMode =
    providerName === 'groq' || (info.supported_parameters ?? []).includes('response_format');
  console.log(`\n== ${model} (json mode: ${supportsJsonMode})`);
  const { rows, stopped } = await runModel(model, supportsJsonMode);
  writeFileSync(
    `poc/poc-3/results/${providerName}_${model.replace(/[/:]/g, '_')}.json`,
    `${JSON.stringify(rows, null, 2)}\n`,
  );
  if (rows.length > 0) summaries.push(summarise(model, rows));
  if (stopped) {
    console.log(`stopped: ${stopped}`);
    break;
  }
}
console.log('\n== Summary');
console.table(summaries);
