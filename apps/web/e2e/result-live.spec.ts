import { expect, test, type Page } from '@playwright/test';

// AP-07-AC01..AC04 on the result page against the API already running on :4000.
// Opt-in (E2E_LIVE_API=1): it reads real questions. Only GET requests leave the browser; POST and
// anything else under /api is aborted. A fake qid is answered inside the browser and never reaches
// the API. No wallet, no signing, no transaction.
const API = process.env.E2E_LIVE_API_ORIGIN ?? 'http://localhost:4000';
test.skip(process.env.E2E_LIVE_API !== '1', 'set E2E_LIVE_API=1 to read the API on :4000');

const hex = (byte: string) => `0x${byte.repeat(32)}`;
const MAIN = 'Khoản có trong luật đã đăng ký on-chain';
const SUB = 'Đoạn trích và mức liên quan: checker đã ký';
const DISCLAIMER = 'Thông tin tham khảo, không thay thế tư vấn pháp lý.';
const TX = /^https:\/\/testnet\.snowtrace\.io\/tx\/0x[0-9a-f]{64}$/;

type Json = Record<string, unknown>;
const fakes = new Map<string, (read: number) => Json>();
const reads = new Map<string, number>();
// Reads `from..to` of a fake qid answer 500 (the API is down for a moment).
const outages = new Map<string, { from: number; to: number }>();
const methods: string[] = [];

async function wire(page: Page) {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    methods.push(request.method());
    if (request.method() !== 'GET') return route.abort();
    const { pathname } = new URL(request.url());
    const qid = pathname.match(/^\/api\/questions\/(0x[0-9a-f]{64})$/)?.[1];
    if (!qid) return route.abort();
    const fake = fakes.get(qid);
    if (fake) {
      const n = (reads.get(qid) ?? 0) + 1;
      reads.set(qid, n);
      const outage = outages.get(qid);
      if (outage && n >= outage.from && n <= outage.to) {
        return route.fulfill({ status: 500, json: { error: { code: 'INTERNAL' } } });
      }
      return route.fulfill({ status: 200, json: { data: fake(n) } });
    }
    // A real qid goes on through the web's own /api rewrite to the API: the real stack, GET only.
    return route.continue();
  });
}

async function listQuestions(page: Page) {
  const response = await page.request.get(`${API}/api/questions?limit=50`);
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { data: Json[] }).data;
}
async function detail(page: Page, qid: string) {
  return ((await (await page.request.get(`${API}/api/questions/${qid}`)).json()) as { data: Json })
    .data;
}

const citation = (over: Json = {}) => ({
  lawId: hex('11'),
  dieu: 25,
  khoan: 2,
  dieuTitle: 'Thời gian thử việc',
  quote: 'Không quá 60 ngày',
  text: 'Không quá 60 ngày đối với công việc.',
  textHash: hex('22'),
  quoteHash: hex('33'),
  verifiedOnChain: true,
  ...over,
});
const fakeBase = {
  question: 'Câu hỏi thử: đóng nhưng chưa có tx chốt?',
  amount: '50000',
  createdAt: Date.UTC(2026, 10, 15, 14, 40),
  answer: 'TRẢ LỜI CHƯA CHỐT',
  noBasis: false,
  citations: [citation()],
};

test.afterAll(() => {
  // Nothing but GET reached the network layer.
  expect(methods.filter((method) => method !== 'GET')).toEqual([]);
});

test('AC01 + AC02: a real PAID question shows the money line, tx links and the two-line mark', async ({
  page,
}) => {
  await wire(page);
  const paid = (await listQuestions(page)).find((q) => q.status === 'PAID');
  test.skip(!paid, 'no PAID question on the API');
  const data = await detail(page, String(paid?.qid));
  const cards = (data.citations as Json[]).length;
  const tx = data.tx as { deposit: string; settle: string };

  await page.goto(`/questions/${data.qid}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(String(data.question));
  await expect(page.getByText('ĐÃ THANH TOÁN', { exact: true })).toBeVisible();
  await expect(page.getByText('0,05 USDC')).toBeVisible();
  await expect(page.getByText(/^\d{2}\/\d{2} \d{2}:\d{2}$/)).toBeVisible();

  const links = page.locator('main a[href*="snowtrace"]');
  await expect(links).toHaveCount(2);
  for (const link of await links.all()) {
    await expect(link).toHaveAttribute('href', TX);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener/);
  }
  await expect(links.nth(0)).toHaveAttribute('href', new RegExp(`${tx.deposit}$`));
  await expect(links.nth(1)).toHaveAttribute('href', new RegExp(`${tx.settle}$`));
  await expect(page.getByRole('link', { name: /^Thanh toán/ })).toBeVisible();

  // The mark: both lines on every verified card, never one without the other.
  expect(cards).toBeGreaterThan(0);
  await expect(page.getByText(MAIN)).toHaveCount(cards);
  await expect(page.getByText(SUB)).toHaveCount(cards);
  await expect(page.locator('body')).not.toContainText(/Đã xác minh|kiểm đúng nguyên văn/);

  // The full text opens, and the quote is marked inside it.
  await page.getByText('Xem nguyên văn').first().click();
  await expect(page.locator('details[open] mark').first()).toBeVisible();
});

test('AC01 + AC04: real refunded and not-found pages', async ({ page }) => {
  await wire(page);
  const list = await listQuestions(page);
  const failed = list.find((q) => q.reason === 'ANSWER_FAILED');
  const noCitation = list.find((q) => q.reason === 'NO_CITATION');

  if (failed) {
    await page.goto(`/questions/${failed.qid}`);
    await expect(page.getByText('ĐÃ HOÀN TIỀN', { exact: true })).toBeVisible();
    await expect(page.getByText(/Hệ thống không trả lời được lúc này/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Hỏi lại' })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Hoàn tiền/ })).toHaveAttribute('href', TX);
    await expect(page.getByText(MAIN)).toHaveCount(0);
    await expect(page.getByText(DISCLAIMER).first()).toBeVisible();
  }
  if (noCitation) {
    await page.goto(`/questions/${noCitation.qid}`);
    await expect(page.getByText('ĐÃ HOÀN TIỀN', { exact: true })).toBeVisible();
    await expect(
      page.getByText('Không tìm thấy căn cứ trong Bộ luật Lao động 2019').first(),
    ).toBeVisible();
    await expect(page.getByText(MAIN)).toHaveCount(0);
    await expect(page.getByText(DISCLAIMER).first()).toBeVisible();
  }
  test.skip(!failed && !noCitation, 'no refunded question on the API');

  await page.goto(`/questions/${hex('ab')}`);
  await expect(page.getByText('Không tìm thấy câu hỏi này.')).toBeVisible();
  await expect(page.getByText(DISCLAIMER)).toBeVisible();
});

test('AC03: closed PAID with no settle tx stays "ĐANG XỬ LÝ", hides the answer, keeps polling, then settles', async ({
  page,
}) => {
  await wire(page);
  const qid = hex('ee');
  fakes.set(qid, (n) => ({
    qid,
    ...fakeBase,
    stage: 'PAID',
    status: 'PAID',
    tx: n >= 4 ? { deposit: hex('d1'), settle: hex('5e') } : { deposit: hex('d1') },
  }));

  await page.goto(`/questions/${qid}`);
  await expect(page.getByText('ĐANG XỬ LÝ', { exact: true })).toBeVisible();
  await expect(page.getByText('TRẢ LỜI CHƯA CHỐT')).toHaveCount(0);
  await expect(page.getByText(MAIN)).toHaveCount(0);
  await expect(page.getByText(/Đã thanh toán|Đã hoàn tiền|Đã xác minh/)).toHaveCount(0);
  await expect(page.getByText(DISCLAIMER).first()).toBeVisible();
  // It keeps asking while the settle tx is missing.
  await expect.poll(() => reads.get(qid) ?? 0, { timeout: 5000 }).toBeGreaterThanOrEqual(3);

  // The 4th read carries the settle tx: only now the page says paid and shows the answer.
  await expect(page.getByText('ĐÃ THANH TOÁN', { exact: true })).toBeVisible({ timeout: 8000 });
  await expect(page.getByText('TRẢ LỜI CHƯA CHỐT')).toBeVisible();
  await expect(page.getByText(MAIN)).toHaveCount(1);
  await expect(page.getByText(SUB)).toHaveCount(1);
});

test('AC03: PENDING · ANSWERING with the answer already in the payload shows no answer and no tick', async ({
  page,
}) => {
  await wire(page);
  const qid = hex('ef');
  fakes.set(qid, () => ({
    qid,
    ...fakeBase,
    stage: 'ANSWERING',
    status: 'PENDING',
    tx: { deposit: hex('d1') },
  }));
  await page.goto(`/questions/${qid}`);
  await expect(page.getByText('ĐANG XỬ LÝ', { exact: true })).toBeVisible();
  await expect(page.getByText('TRẢ LỜI CHƯA CHỐT')).toHaveCount(0);
  await expect(page.getByText(MAIN)).toHaveCount(0);
  await expect(page.getByText(/Đã thanh toán|Đã hoàn tiền/)).toHaveCount(0);
});

test('AC02: a PAID card the server could not match to the chain gets no tick', async ({ page }) => {
  await wire(page);
  const qid = hex('f1');
  fakes.set(qid, () => ({
    qid,
    ...fakeBase,
    stage: 'PAID',
    status: 'PAID',
    citations: [citation({ verifiedOnChain: false })],
    tx: { deposit: hex('d1'), settle: hex('5e') },
  }));
  await page.goto(`/questions/${qid}`);
  await expect(page.getByText('ĐÃ THANH TOÁN', { exact: true })).toBeVisible();
  await expect(page.getByText('Chưa đối chiếu được trích dẫn với blockchain.')).toBeVisible();
  await expect(page.getByText(MAIN)).toHaveCount(0);
  await expect(page.getByText(SUB)).toHaveCount(0);
});

test('AC04: the disclaimer is there from the first paint (slow load) and there is one legal landmark', async ({
  page,
}) => {
  const qid = hex('f0');
  const body = {
    qid,
    ...fakeBase,
    stage: 'PAID',
    status: 'PAID',
    tx: { deposit: hex('d1'), settle: hex('5e') },
  };
  // Hold the first read open: the skeleton is on screen while the disclaimer is already there.
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/**', async (route) => {
    methods.push(route.request().method());
    if (route.request().method() !== 'GET') return route.abort();
    if (!route.request().url().endsWith(`/api/questions/${qid}`)) return route.abort();
    await gate;
    return route.fulfill({ status: 200, json: { data: body } });
  });
  await page.goto(`/questions/${qid}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText(DISCLAIMER).first()).toBeVisible();
  await expect(page.locator('[aria-busy="true"]')).toBeVisible();
  release();
  await expect(page.getByText('ĐÃ THANH TOÁN', { exact: true })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Lưu ý pháp lý' })).toHaveCount(1);
  await expect(page.getByText(DISCLAIMER)).toHaveCount(2); // under the answer, and the footer
});

test('poll limit: a closed PAID that never gets a settle tx stops after the limit and offers a retry', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await wire(page);
  const qid = hex('e1');
  fakes.set(qid, () => ({
    qid,
    ...fakeBase,
    stage: 'PAID',
    status: 'PAID',
    tx: { deposit: hex('d1') },
  }));
  await page.goto(`/questions/${qid}`);
  await expect(page.getByText('ĐANG XỬ LÝ', { exact: true })).toBeVisible();

  await expect(page.getByText('Chưa nhận được xác nhận chốt từ blockchain.')).toBeVisible({
    timeout: 50_000,
  });
  // Still "ĐANG XỬ LÝ": no settle tx, so nothing is said as paid and the answer stays hidden.
  await expect(page.getByText('ĐANG XỬ LÝ', { exact: true })).toBeVisible();
  await expect(page.getByText('TRẢ LỜI CHƯA CHỐT')).toHaveCount(0);
  const stopped = reads.get(qid) ?? 0;
  expect(stopped).toBeLessThanOrEqual(32); // the first read + 30 more, not "forever"
  await page.waitForTimeout(3000);
  expect(reads.get(qid)).toBe(stopped); // really stopped

  // "Thử lại" gives it a new allowance.
  await page.getByRole('button', { name: 'Thử lại' }).click();
  await expect.poll(() => reads.get(qid) ?? 0, { timeout: 5000 }).toBeGreaterThan(stopped);
});

test('reconnect line: "đang thử lại" only while another read is coming', async ({ page }) => {
  await wire(page);
  const qid = hex('e2');
  fakes.set(qid, () => ({
    qid,
    ...fakeBase,
    stage: 'ANSWERING',
    status: 'PENDING',
    tx: { deposit: hex('d1') },
  }));
  outages.set(qid, { from: 2, to: 3 });
  await page.goto(`/questions/${qid}`);
  await expect(page.getByText('ĐANG XỬ LÝ', { exact: true })).toBeVisible();
  // Data stays on screen, with the small line, while polling goes on.
  await expect(page.getByText('Mất kết nối, đang thử lại…')).toBeVisible();
  await expect(page.getByText('ĐANG XỬ LÝ', { exact: true })).toBeVisible();
  await expect(page.getByText('Mất kết nối, đang thử lại…')).toHaveCount(0, { timeout: 8000 });
});

test('reconnect line: on a settled page with no read coming it says the page may be stale, with a retry', async ({
  page,
}) => {
  await wire(page);
  const qid = hex('e3');
  fakes.set(qid, () => ({
    qid,
    ...fakeBase,
    stage: 'PAID',
    status: 'PAID',
    tx: { deposit: hex('d1'), settle: hex('5e') },
  }));
  outages.set(qid, { from: 2, to: 99 });
  await page.goto(`/questions/${qid}`);
  await expect(page.getByText('ĐÃ THANH TOÁN', { exact: true })).toBeVisible();
  // A refocus read fails; the page is settled, so no further read is scheduled.
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByText('Mất kết nối. Thông tin trên trang có thể đã cũ.')).toBeVisible();
  await expect(page.getByText('Mất kết nối, đang thử lại…')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Thử lại' })).toBeVisible();
  // The data is kept.
  await expect(page.getByText('TRẢ LỜI CHƯA CHỐT')).toBeVisible();
});

test.describe('E22: 360px and keyboard on a real PAID page', () => {
  test.use({ viewport: { width: 360, height: 800 } });

  test('no sideways scroll, the short hashes are whole, and Tab reaches links, the card, then the last button', async ({
    page,
  }) => {
    await wire(page);
    const paid = (await listQuestions(page)).find((q) => q.status === 'PAID');
    test.skip(!paid, 'no PAID question on the API');
    await page.goto(`/questions/${String(paid?.qid)}`);
    await expect(page.getByText('ĐÃ THANH TOÁN', { exact: true })).toBeVisible();

    const overflow = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      cut: [...document.querySelectorAll<HTMLElement>('main a[href*="snowtrace"] span.font-mono')]
        .filter((el) => el.scrollWidth > el.clientWidth + 1)
        .map((el) => el.textContent),
    }));
    expect(overflow.page).toBeLessThanOrEqual(0);
    expect(overflow.cut).toEqual([]);
    for (const link of await page.locator('main a[href*="snowtrace"]').all()) {
      const box = await link.boundingBox();
      expect(box && box.x >= 0 && box.x + box.width <= 360).toBe(true);
    }

    // Keyboard: Tab order, and Enter opens the card.
    const order: string[] = [];
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Tab');
      const now = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el) return null;
        const style = getComputedStyle(el);
        const visible =
          (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) ||
          style.boxShadow !== 'none';
        const isTx = el.tagName === 'A' && el.getAttribute('href')?.includes('snowtrace');
        return { label: isTx ? 'tx' : (el.textContent ?? '').trim().slice(0, 30), visible };
      });
      if (!now) continue;
      order.push(now.label);
      if (now.label === 'Xem nguyên văn') {
        expect(now.visible).toBe(true); // the focus ring can be seen
        await page.keyboard.press('Enter');
        await expect(page.locator('details[open]')).toHaveCount(1);
      }
      if (now.label === 'Hỏi câu khác') {
        expect(now.visible).toBe(true);
        break;
      }
    }
    const tx = order.indexOf('tx');
    const card = order.indexOf('Xem nguyên văn');
    const last = order.indexOf('Hỏi câu khác');
    expect(tx).toBeGreaterThanOrEqual(0);
    expect(card).toBeGreaterThan(tx);
    expect(last).toBeGreaterThan(card);
  });
});
