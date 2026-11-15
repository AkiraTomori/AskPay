# apps/web — Kiến trúc

Next.js App Router + React 19 + wagmi/viem + Tailwind 4. Quy tắc ở [frontend convention](../../docs/conventions/frontend.md); giao diện theo [design-system](../../docs/product/design-system.md). Thiết kế slice W1 ở [docs/design/w1-web-shell.md](../../docs/design/w1-web-shell.md), W2 ở [docs/design/w2-ask.md](../../docs/design/w2-ask.md), W3 ở [docs/design/w3-result.md](../../docs/design/w3-result.md), W4 ở [docs/design/w4-dashboard.md](../../docs/design/w4-dashboard.md).

```
src/
  app/                 route và layout: layout.tsx (font, Providers, AppShell), page.tsx (Hỏi), questions/[qid]/page.tsx, dashboard/page.tsx, not-found.tsx,
                       error.tsx, global-error.tsx (tự render DisclaimerBanner), providers.tsx, globals.css (token)
  features/
    ask/               luồng hỏi và trả tiền (W2): hooks.ts (useAsk, useQuestionProgress), ask-state.ts (máy trạng thái),
                       ask-view.ts (nút và thông báo suy ra từ trạng thái), payment.ts (EIP-3009, hạn báo giá),
                       submit-outcome.ts (phân nhóm kết quả POST lần hai), steps.ts, question.ts, api.ts, messages.ts;
                       trang kết quả (W3): result-view.ts (hàm thuần `toResultView`: toàn bộ bảng trạng thái),
                       quote-match.ts (`locateQuote`, tô đoạn trích trong nguyên văn);
                       components/ AskForm, QuestionForm, SampleChips, PriceNotice, AskButton, AskNotice, StepTimeline,
                       ResultView, ResultMeta, AnswerBody, CitationList, CitationCard, VerifiedMark, RefundNotice
    dashboard/         dashboard công khai (W4): api.ts (getStats, getQuestions; `LoadError` mang mã lỗi), hooks.ts (useStats, useRecentQuestions:
                       trang 1 là query tự làm mới 15 giây, trang 2+ là state cục bộ, không làm mới), dashboard-view.ts (hàm thuần: thẻ, lý do hoàn tiền,
                       eval, hàng bảng), messages.ts; components/ DashboardView, StatTiles, ProvenanceNote, RefundReasonList, EvalPanel,
                       RecentQuestions, QuestionTable, BlockError
  components/
    ui/                dùng chung, không biết nghiệp vụ: Button, Skeleton, Address, Dialog, Badge, Card, TxLink
    layout/            AppShell, SiteHeader, MobileNav, SiteFooter, DisclaimerBanner, nav-items.ts
    question/          biết nghiệp vụ câu hỏi, dùng chung W3 và W4: status.ts (`isSettled`, `badgeOf`, kiểu `Badge`, nhãn badge), StatusBadge
    wallet/            ConnectButton, ConnectDialog(+Provider, context), AccountMenu, NetworkGuard,
                       NetworkChip; hook use-wallet-status.ts, use-usdc-balance.ts
  lib/
    api.ts             client API duy nhất (`apiFetch` → ApiResult, có `meta` của envelope); mọi lời gọi /api/* đi qua đây
    wagmi.ts           cấu hình wagmi: chỉ Fuji, connector injected
    constants.ts       chain ID, RPC, link Snowtrace/faucet/cài ví, REPO_URL (một chỗ để W2, W4 dùng lại)
    format.ts          bigint → "12,5", số nguyên "1.284", tỉ lệ "26,2%", rút gọn địa chỉ và hash, link Snowtrace (địa chỉ, tx), giờ Việt Nam
    messages.ts        mọi chuỗi giao diện (tiếng Việt)
    wallet-errors.ts   phân loại lỗi ví (từ chối 4001, đang chờ -32002, khác)
    cn.ts              clsx + tailwind-merge
e2e/                   Playwright (`npm run e2e -w apps/web`): chỉ cho thứ jsdom không thấy được (router Next, head, CSS thật). Chromium của Playwright
                       cài trong repo (`npm run e2e:install -w apps/web`, vào `node_modules`), build riêng `.next-e2e`, cổng 3100, API được giả bằng `page.route`
                       nên không chạm server, chain hay ví. Không nằm trong `npm run verify`
test/                  Vitest + Testing Library (jsdom), phản chiếu src/; test/helpers: ví giả (mock connector)
```

- Địa chỉ contract và token lấy từ `fujiDeployment` của `@askpay/shared/abi`; không chép vào đây.
- Cho W2–W5: `useWalletStatus()` (trạng thái ví), `useConnectDialog().openConnectDialog()` (mở hộp thoại kết nối), `useUsdcBalance()` (query số dư; invalidate sau khi trả tiền).
- Chạy từ gốc repo: `npm run dev:web` (cổng 3000), `npm run build:web`; cả hai build `packages/shared` trước vì web đọc `@askpay/shared` từ `dist/`. `NEXT_PUBLIC_RPC_URL` (tuỳ chọn) đổi RPC Fuji; mặc định là publicnode vì RPC công cộng của Avalanche có thể rate limit. **`API_ORIGIN` bắt buộc** (ví dụ `http://localhost:4000` trong `apps/web/.env.local`): `next.config.ts` rewrite `/api/*` sang đó và báo lỗi nếu thiếu; `experimental.proxyTimeout` là 75 giây vì server giữ POST /api/ask tới 60 giây.
