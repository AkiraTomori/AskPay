import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.js';
import {
  TEST_KEY,
  apiError,
  countingSigner,
  fakeApi,
  fakeClock,
  happyHandler,
  qidOf,
  quote,
  result,
  type Handler,
} from './harness.js';

function questionsFile(lines: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'askpay-agent-'));
  const file = join(dir, 'questions.txt');
  writeFileSync(file, lines.join('\n'));
  return file;
}

async function run(
  argv: string[],
  options: {
    handler?: Handler;
    env?: NodeJS.ProcessEnv;
    withSigner?: boolean;
  } = {},
) {
  const api = fakeApi(options.handler ?? happyHandler());
  const { signer, calls } = countingSigner();
  const clock = fakeClock();
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCli(argv, options.env ?? {}, {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    fetch: api.fetch,
    ...(options.withSigner === false ? {} : { signer }),
    now: clock.now,
    sleep: clock.sleep,
  });
  return { code, out: out.join('\n'), err: err.join('\n'), api, signs: calls.length };
}

describe('AP-10-AC01 · the command line', () => {
  it('AP-10-AC01: reads the question list, pays each one and prints the results', async () => {
    const file = questionsFile([
      '# comment',
      'Thử việc tối đa bao lâu?',
      '',
      'Nghỉ phép năm bao nhiêu ngày?',
    ]);
    const { code, out, api, signs } = await run(['--budget', '0.20', file]);

    expect(code).toBe(0);
    expect(signs).toBe(2);
    expect(api.payCalls()).toHaveLength(2);
    expect(out).toContain('[1/2] Thử việc tối đa bao lâu?');
    expect(out).toContain('[2/2] Nghỉ phép năm bao nhiêu ngày?');
    expect(out).toContain('Trạng thái: PAID');
    expect(out).toContain('Trả lời: Trả lời mẫu');
    expect(out).toContain('Trích dẫn: Đ25 K2');
    expect(out).toContain(`https://testnet.snowscan.xyz/tx/${qidOf(8)}`);
    expect(out).toContain('Đã cam kết: 0.1 / 0.2 USDC');
    expect(out).toContain('Paid: 2 · Refunded: 0');
    expect(out).toContain('Chưa hỏi: 0');
    expect(out).toContain('Thông tin tham khảo, không thay thế tư vấn pháp lý.');
    expect(out).not.toContain('{'); // never raw JSON
  });

  it('prints a refund with its reason, and still exits 0', async () => {
    const { code, out } = await run(['--budget', '0.20', 'Một câu hỏi?'], {
      handler: happyHandler('REFUNDED'),
    });
    expect(code).toBe(0);
    expect(out).toContain('Trạng thái: REFUNDED (CHECKER_REJECTED)');
    expect(out).toContain('Trích dẫn không đúng nguyên văn');
    expect(out).toContain('Paid: 0 · Refunded: 1');
  });

  it('takes questions given directly as arguments and accepts --budget=value', async () => {
    const { code, signs } = await run(['--budget=0.10', 'Câu một?', 'Câu hai?']);
    expect(code).toBe(0);
    expect(signs).toBe(2);
  });

  it('prints a Điều without a Khoản as Đ25 only', async () => {
    const handler: Handler = (call, state) => {
      if (!call.paymentSignature) return { status: 402, json: quote({}, state.quotes) };
      const base = result(call.body?.qid ?? '').data;
      const first = base.citations[0];
      return { status: 200, json: { data: { ...base, citations: [{ ...first, khoan: 0 }] } } };
    };
    const { out } = await run(['--budget', '0.20', 'Câu hỏi?'], { handler });
    expect(out).toContain('Trích dẫn: Đ25\n');
  });

  it('skips a question the API refuses without stopping the run', async () => {
    let quotes = 0;
    const handler: Handler = (call, state) => {
      if (!call.paymentSignature) {
        return ++quotes === 1
          ? apiError(400, 'VALIDATION_FAILED')
          : { status: 402, json: quote({}, state.quotes) };
      }
      return { status: 200, json: result(call.body?.qid ?? '') };
    };
    const { code, out } = await run(['--budget', '0.20', 'Câu một?', 'Câu hai?'], { handler });
    expect(code).toBe(0);
    expect(out).toContain('Bỏ qua:');
    expect(out).toContain('Paid: 1 · Refunded: 0 · Chưa rõ: 0 · Bỏ qua: 1');
  });
});

describe('AP-10-AC02 · the cap stops the run', () => {
  const questions = ['Câu 1?', 'Câu 2?', 'Câu 3?'];

  it('AP-10-AC02: a cap of two prices signs two, the third is not signed, exit code 2', async () => {
    const { code, out, signs, api } = await run(['--budget', '0.10', ...questions]);
    expect(code).toBe(2);
    expect(signs).toBe(2);
    expect(api.payCalls()).toHaveLength(2);
    expect(out).toContain(
      'DỪNG: budget reached: 0.1 of 0.1 USDC committed, next question costs 0.05',
    );
    expect(out).toContain('Chưa hỏi: 1');
    expect(out).toContain('Các câu chưa hỏi:\n  - Câu 3?');
    expect(out).toContain('Đã cam kết: 0.1 / 0.1 USDC');
  });

  it('AP-10-AC02: a cap equal to the total still signs the last question', async () => {
    const { code, signs } = await run(['--budget', '0.15', ...questions]);
    expect(code).toBe(0);
    expect(signs).toBe(3);
  });

  it('AP-10-AC02: a cap below one price signs nothing and lists every question as not asked', async () => {
    const { code, out, signs, api } = await run(['--budget', '0.049999', ...questions]);
    expect(code).toBe(2);
    expect(signs).toBe(0);
    expect(api.payCalls()).toHaveLength(0);
    expect(out).toContain('Chưa hỏi: 3');
    for (const question of questions) expect(out).toContain(`  - ${question}`);
  });

  it('exits 1 and lists the rest when a quote is refused by the guard', async () => {
    const handler: Handler = (_call, state) => ({
      status: 402,
      json: quote({ payTo: `0x${'ab'.repeat(20)}` }, state.quotes),
    });
    const { code, signs, out } = await run(['--budget', '0.20', ...questions], { handler });
    expect(code).toBe(1);
    expect(signs).toBe(0);
    expect(out).toContain('Chưa hỏi: 3');
  });

  it('exits 1 when the chain is unavailable, with the cap given back', async () => {
    const handler: Handler = (call, state) =>
      call.paymentSignature
        ? apiError(503, 'CHAIN_UNAVAILABLE')
        : { status: 402, json: quote({}, state.quotes) };
    const { code, out } = await run(['--budget', '0.20', ...questions], { handler });
    expect(code).toBe(1);
    expect(out).toContain('Đã cam kết: 0 / 0.2 USDC');
  });
});

describe('usage errors send nothing', () => {
  const cases: [string, string[]][] = [
    ['no --budget', ['Câu hỏi?']],
    ['a malformed --budget', ['--budget', '1e-2', 'Câu hỏi?']],
    ['an empty --budget', ['--budget', '', 'Câu hỏi?']],
    ['no questions', ['--budget', '0.20']],
    ['a missing questions file', ['--budget', '0.20', '/nonexistent/questions.txt']],
    ['an unknown option', ['--budget', '0.20', '--dry-run', 'Câu hỏi?']],
    ['a single-dash typo of --budget', ['-budget', '0.20', 'Câu hỏi?']],
    ['a short option', ['--budget', '0.20', '-b', '0.5', 'Câu hỏi?']],
    ['a single-dash option with =', ['-budget=0.20', 'Câu hỏi?']],
    [
      'a missing file whose name has a space',
      ['--budget', '0.20', '/nonexistent/my questions.txt'],
    ],
  ];
  it.each(cases)('%s: exit 1, no request, no signature', async (_name, argv) => {
    const { code, err, api, signs } = await run(argv);
    expect(code).toBe(1);
    expect(err).toContain('ERROR:');
    expect(api.calls).toHaveLength(0);
    expect(signs).toBe(0);
  });

  it('a questions file with a space in its name is read as a file, and its questions are paid', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'askpay-agent-'));
    const file = join(dir, 'my questions.txt');
    writeFileSync(file, 'Câu một?\n# ghi chú\nCâu hai?\n');
    const { code, api, signs } = await run(['--budget', '0.20', file]);
    expect(code).toBe(0);
    expect(api.payCalls().map((c) => c.body?.question)).toEqual(['Câu một?', 'Câu hai?']);
    expect(signs).toBe(2);
  });
});

describe('secrets', () => {
  it('a missing key stops with a fixed message before any request', async () => {
    const { code, err, api } = await run(['--budget', '0.20', 'Câu hỏi?'], { withSigner: false });
    expect(code).toBe(1);
    expect(err).toContain('E2E_PAYER_PRIVATE_KEY is not set');
    expect(api.calls).toHaveLength(0);
  });

  it.each(['not-a-key', `0x${'zz'.repeat(32)}`, `0x${'11'.repeat(31)}`])(
    'a malformed key (%s) is rejected without echoing it',
    async (bad) => {
      const { code, out, err, api } = await run(['--budget', '0.20', 'Câu hỏi?'], {
        withSigner: false,
        env: { E2E_PAYER_PRIVATE_KEY: bad },
      });
      expect(code).toBe(1);
      expect(`${out}${err}`).not.toContain(bad);
      expect(err).toContain('not a 32-byte hex private key');
      expect(api.calls).toHaveLength(0);
    },
  );

  it('a valid key signs, shows only the wallet address and never appears in the output', async () => {
    const { code, out, err, api } = await run(['--budget', '0.20', 'Câu hỏi?'], {
      withSigner: false,
      env: { E2E_PAYER_PRIVATE_KEY: TEST_KEY },
    });
    expect(code).toBe(0);
    expect(api.payCalls()).toHaveLength(1);
    expect(out).toContain('Ví người hỏi: 0x');
    const bare = TEST_KEY.slice(2);
    expect(`${out}${err}`).not.toContain(bare);
  });

  it('also accepts a key without the 0x prefix', async () => {
    const { code } = await run(['--budget', '0.20', 'Câu hỏi?'], {
      withSigner: false,
      env: { E2E_PAYER_PRIVATE_KEY: TEST_KEY.slice(2) },
    });
    expect(code).toBe(0);
  });

  it('refuses a key passed on the command line, as an option or as an argument, and never sends it as a question', async () => {
    for (const argv of [
      ['--budget', '0.20', '--private-key', TEST_KEY],
      ['--budget', '0.20', `--private-key=${TEST_KEY}`],
      ['--budget', '0.20', TEST_KEY],
      ['--budget', '0.20', TEST_KEY.slice(2)],
      ['--budget', '0.20', `--${TEST_KEY}`],
      ['--budget', '0.20', `-${TEST_KEY.slice(2)}`],
    ]) {
      const { code, out, err, api } = await run(argv, { withSigner: false });
      expect(code).toBe(1);
      // Not even a fragment of the key may be echoed back.
      expect(`${out}${err}`).not.toContain(TEST_KEY.slice(2, 18));
      expect(api.calls).toHaveLength(0);
    }
  });
});

describe('API_URL', () => {
  it('rejects an invalid URL before sending anything', async () => {
    const { code, err, api } = await run(['--budget', '0.20', 'Câu hỏi?'], {
      env: { API_URL: 'not a url' },
    });
    expect(code).toBe(1);
    expect(err).toContain('API_URL');
    expect(api.calls).toHaveLength(0);
  });

  it('uses the price the server quotes, in units of the token', async () => {
    const { out } = await run(['--budget', '1', 'Câu hỏi?']);
    expect(out).toContain('Đã cam kết: 0.05 / 1 USDC');
  });
});
