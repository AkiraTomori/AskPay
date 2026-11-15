import { expect, test, type Page } from '@playwright/test';

const QID = `0x${'9f'.repeat(32)}`;
const QUESTION = 'Thời gian thử việc tối đa với công việc cần bằng cao đẳng là bao lâu?';
const TITLE = `${QUESTION.slice(0, 60)}… · AskPay`;

// The API as the browser sees it: a settled, paid question. Nothing leaves the browser.
async function answerApi(page: Page) {
  await page.route('**/api/questions/*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          qid: QID,
          question: QUESTION,
          stage: 'PAID',
          status: 'PAID',
          amount: '50000',
          answer: 'Theo Khoản 2 Điều 25, thời gian thử việc không quá 60 ngày.',
          noBasis: false,
          citations: [],
          tx: { deposit: `0x${'d1'.repeat(32)}`, settle: `0x${'5e'.repeat(32)}` },
          createdAt: Date.UTC(2026, 10, 15, 14, 40),
        },
      }),
    }),
  );
}

// Real Next router and head. In a real browser Next also resets the title on a client navigation,
// so this guards the behaviour as a whole (set, reset, set again), not the cleanup in ResultView alone.
test('W3: the tab title is the question, and the next page does not keep it', async ({ page }) => {
  await answerApi(page);
  await page.goto(`/questions/${QID}`);
  await expect(page.getByText('ĐÃ THANH TOÁN', { exact: true })).toBeVisible();
  await expect(page).toHaveTitle(TITLE);

  // Client-side navigation to the Ask page (no reload): the title goes back to the site's.
  await page.getByRole('link', { name: 'Hỏi câu khác' }).click();
  await expect(page).toHaveURL('/');
  await expect(page).toHaveTitle('AskPay');

  // Back to the question: the title follows again.
  await page.goBack();
  await expect(page.getByText('ĐÃ THANH TOÁN', { exact: true })).toBeVisible();
  await expect(page).toHaveTitle(TITLE);
});
