# apps/web — Kiến trúc

Next.js App Router + React 19 + wagmi/viem + Tailwind 4. Quy tắc ở [frontend convention](../../docs/conventions/frontend.md); giao diện theo [design-system](../../docs/product/design-system.md). Thiết kế slice W1 ở [docs/design/w1-web-shell.md](../../docs/design/w1-web-shell.md).

```
src/
  app/                 route và layout: layout.tsx (font, Providers, AppShell), page.tsx, not-found.tsx,
                       error.tsx, global-error.tsx (tự render DisclaimerBanner), providers.tsx, globals.css (token)
  components/
    ui/                dùng chung, không biết nghiệp vụ: Button, Skeleton, Address, Dialog
    layout/            AppShell, SiteHeader, MobileNav, SiteFooter, DisclaimerBanner, nav-items.ts
    wallet/            ConnectButton, ConnectDialog(+Provider, context), AccountMenu, NetworkGuard,
                       NetworkChip; hook use-wallet-status.ts, use-usdc-balance.ts
  lib/
    wagmi.ts           cấu hình wagmi: chỉ Fuji, connector injected
    constants.ts       chain ID, RPC, link Snowtrace/faucet/cài ví (một chỗ để W2 dùng lại)
    format.ts          bigint → "12,5", rút gọn địa chỉ, link Snowtrace
    messages.ts        mọi chuỗi giao diện (tiếng Việt)
    wallet-errors.ts   phân loại lỗi ví (từ chối 4001, đang chờ -32002, khác)
    cn.ts              clsx + tailwind-merge
test/                  Vitest + Testing Library (jsdom), phản chiếu src/; test/helpers: ví giả (mock connector)
```

- Địa chỉ contract và token lấy từ `fujiDeployment` của `@askpay/shared/abi`; không chép vào đây.
- Cho W2–W5: `useWalletStatus()` (trạng thái ví), `useConnectDialog().openConnectDialog()` (mở hộp thoại kết nối), `useUsdcBalance()` (query số dư; invalidate sau khi trả tiền).
- Chạy từ gốc repo: `npm run dev:web` (cổng 3000), `npm run build:web`; cả hai build `packages/shared` trước vì web đọc `@askpay/shared` từ `dist/`. `NEXT_PUBLIC_RPC_URL` (tuỳ chọn) đổi RPC Fuji.
