# Frontend convention (Next.js App Router, React, TypeScript)

Áp dụng cho `apps/web`. Rút từ convention frontend của Fablewelf, bỏ phần đăng nhập, bản thảo, i18n hai ngôn ngữ; thêm phần ví và trạng thái giao dịch.

## 1. Cấu trúc

```
apps/web/src/
  app/                   # chỉ route: layout.tsx, page.tsx, loading.tsx, error.tsx
    page.tsx             # màn hình hỏi
    dashboard/page.tsx
    questions/[qid]/page.tsx
    verify/page.tsx
  features/
    ask/
      components/        # QuestionForm, PriceNotice, AnswerCard, CitationCard…
      api.ts             # gọi /api/ask, kiểu lấy từ @askpay/shared
      hooks.ts           # useAsk: điều phối 402 → ký → gửi lại
    dashboard/
      components/ api.ts hooks.ts
  components/
    ui/                  # dùng chung, không biết nghiệp vụ (Button, Badge, Card…)
    layout/              # header, footer, DisclaimerBanner
    wallet/              # ConnectButton, NetworkGuard: dùng chung cho mọi feature
  lib/
    api.ts               # một API client duy nhất, đọc envelope {data}/{error}
    wagmi.ts             # cấu hình wagmi: chỉ chain Fuji
    format.ts            # bigint → chuỗi USDC, rút gọn địa chỉ, link Snowtrace
apps/web/test/           # Vitest + Testing Library, phản chiếu src/
```

- Kiểu request/response, ABI, địa chỉ contract import từ `@askpay/shared`. Không khai lại trong `apps/web`.
- `page.tsx` mỏng: lấy tham số, render component của feature.
- Feature chỉ import từ `components/`, `lib/` và chính nó. Không import chéo `features/a` → `features/b`.
- Tên: component `PascalCase.tsx`; còn lại `kebab-case.ts`; hook `useXxx`. Không barrel file (`index.ts` re-export).
- Component ≤ ~200 dòng; vượt thì tách. Một file một component chính.

## 2. Dữ liệu và trạng thái

- Gọi API qua **một** client trong `lib/api.ts`, cùng origin (`/api/...` được Next rewrite sang `apps/api`). Component không gọi `fetch` trực tiếp.
- Server state dùng **TanStack Query** (wagmi vốn đã cần nó). Trạng thái ví và chain dùng hook của **wagmi**.
- Luồng trả tiền gói trong **một** hook `useAsk`: gửi câu hỏi → nhận 402 → ký EIP-712 (EIP-3009) bằng ví → gửi lại kèm `PAYMENT-SIGNATURE` → nhận kết quả. Component chỉ đọc trạng thái của hook.
- Số tiền giữ ở dạng `bigint` cho tới lúc hiển thị (`lib/format.ts`).
- Trạng thái nên ở URL (ví dụ `/questions/[qid]`) để link chia sẻ được và tải lại không mất.

## 3. Trạng thái màn hình

Mọi màn hình phân biệt rõ: đang tải · rỗng · lỗi tải (khác rỗng) · thành công.

Thêm các trạng thái riêng của ví và giao dịch:

| Trạng thái | Người dùng thấy |
|---|---|
| Chưa kết nối ví | Nút kết nối; ô hỏi vẫn gõ được |
| Sai mạng | Thông báo và nút chuyển sang Avalanche Fuji |
| Không đủ USDC | Số dư hiện tại, giá câu hỏi, link faucet |
| Đang chờ ký | "Xác nhận trong ví…" kèm số tiền chính xác |
| Người dùng từ chối ký | Quay về form, giữ nguyên câu hỏi |
| Đang xử lý | Các bước: đã giữ tiền → đang trả lời → đang kiểm tra → đang chốt |
| **Paid** | Câu trả lời, thẻ trích dẫn có dấu "✓ đã xác minh on-chain", link tx |
| **Refunded** | Lý do hoàn tiền (không trích dẫn / trích dẫn sai / checker từ chối), link tx hoàn tiền |
| Quá hạn chưa chốt | Nút "Nhận lại tiền" (gọi `claimRefund`) |

Không bao giờ hiện "Đã trả tiền" hay "Đã xác minh" trước khi có receipt trên chain.

## 4. Style và giao diện

- Theo [design-system.md](../product/design-system.md) (bắt buộc).
- Tailwind CSS. Màu và khoảng cách lấy từ token khai báo một chỗ (`globals.css`), không giá trị tuỳ tiện.
- Truy cập được bằng bàn phím; nút có nhãn; màu không phải tín hiệu duy nhất (Paid/Refunded có cả chữ và icon).
- **Disclaimer pháp lý luôn hiển thị**: "Thông tin tham khảo, không thay thế tư vấn pháp lý."

## 5. Ngôn ngữ

Giao diện chỉ tiếng Việt trong MVP. Chuỗi giao diện gom trong `features/<tên>/messages.ts` (hoặc `lib/messages.ts` nếu dùng chung) để sau dễ tách i18n. Không thư viện i18n.

## 6. Test

- Vitest + Testing Library cho component và hook, trong `apps/web/test/`.
- Ưu tiên test `useAsk` với ví và API giả lập: đủ các nhánh ở §3.
- E2E bằng trình duyệt thật không bắt buộc trong MVP. Kịch bản demo thủ công ghi trong spec và chạy lại trước khi quay video.
- Tên test theo hành vi, kèm ID `AP-xx-ACnn`.

## 7. Tài liệu kiến trúc

Một `apps/web/ARCHITECTURE.md` ngắn (cây thư mục + 1 dòng mỗi thư mục), cập nhật cùng PR khi đổi cấu trúc.
