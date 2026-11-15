# Design system: "Công Báo"

> **Bắt buộc cho mọi thay đổi trong `apps/web`.** Bố cục từng trang ở [`ui-pages.md`](./ui-pages.md).

## 1. Triết lý

AskPay bán **sự tin cậy**, nên giao diện trông như một văn bản pháp lý đáng tin, không như một ứng dụng crypto lòe loẹt.

- **Giấy và mực:** nền giấy ngà, chữ mực đậm. Đoạn trích luật in chữ có chân như công báo.
- **Bằng chứng lên trước:** mỗi khẳng định đi kèm căn cứ (Điều/Khoản) và bằng chứng (tx, dấu ✓).
- **Trạng thái tiền rõ như hoá đơn:** đã giữ, đã trả hay đã hoàn được nói bằng chữ, màu và icon cùng lúc.
- **Hoàn tiền không phải lỗi:** dùng màu hổ phách, không dùng màu đỏ. Đỏ chỉ dành cho lỗi hệ thống.

## 2. Token

Khai báo một lần trong `apps/web/src/app/globals.css` (Tailwind 4 `@theme`). Không dùng mã màu trực tiếp trong component.

### 2.1 Màu (chỉ chế độ sáng ở v1)

| Token | Giá trị | Dùng cho |
|---|---|---|
| `--color-paper` | `#FAF7F0` | Nền trang |
| `--color-surface` | `#FFFFFF` | Thẻ, khung |
| `--color-ink` | `#1C1B19` | Chữ chính |
| `--color-ink-muted` | `#5C5A55` | Chữ phụ, chú thích |
| `--color-rule` | `#E4DFD3` | Viền, đường kẻ |
| `--color-seal` | `#7A1F1F` | Màu thương hiệu (con dấu), logo, nút chính |
| `--color-seal-ink` | `#FFFFFF` | Chữ trên nền `seal` |
| `--color-paid` | `#1F6F43` | ĐÃ THANH TOÁN, dấu ✓ đã xác minh |
| `--color-refund` | `#9A6200` | ĐÃ HOÀN TIỀN, khung cảnh báo |
| `--color-pending` | `#1F4E8C` | ĐANG XỬ LÝ |
| `--color-expired` | `#6B6B6B` | QUÁ HẠN |
| `--color-error` | `#B42318` | Chỉ cho lỗi hệ thống và lỗi nhập |
| `--color-focus` | `#1F4E8C` | Viền focus (2px) |

Mọi cặp chữ/nền đạt tương phản WCAG AA (≥ 4,5:1 cho chữ thường). Kiểm lại bằng công cụ khi cài.

Hai quy tắc bổ sung (owner duyệt 15/11/2026, xem [w1-web-shell §6.4](../design/w1-web-shell.md)):
- Chữ trên nền hổ phách nhạt (`refund` 12%) dùng `ink`, không dùng `refund` (4,07:1, không đạt AA).
- Viền nút `secondary` và ô nhập dùng `ink-muted`, không dùng `rule` (1,24:1; WCAG 1.4.11 cần ≥ 3:1). `rule` chỉ cho đường kẻ trang trí.

### 2.2 Chữ

| Token | Font | Dùng cho |
|---|---|---|
| `--font-sans` | Be Vietnam Pro (`next/font`) | Toàn bộ giao diện |
| `--font-serif` | Noto Serif | **Chỉ** nguyên văn và đoạn trích luật |
| `--font-mono` | JetBrains Mono | Địa chỉ ví, hash, tx |

Thang cỡ chữ: 12 / 14 / 16 (gốc) / 18 / 24 / 32. Chiều cao dòng 1,6 cho văn bản, 1,75 cho đoạn trích luật.

### 2.3 Khác

- Bo góc: 6px cho thẻ và nút; badge bo tròn hẳn.
- Khoảng cách: bội số của 4px.
- Bóng: chỉ một mức `0 1px 2px rgb(0 0 0 / 0.06)` cho thẻ. Không bóng đậm.
- Chuyển động: ≤ 200ms; tôn trọng `prefers-reduced-motion`.

## 3. Component

| Component | Ở đâu | Mô tả |
|---|---|---|
| `Button` | `components/ui` | `primary` (seal), `secondary` (viền), `ghost`; có trạng thái `loading` |
| `Badge` | `components/ui` | Nền nhạt + chữ đậm cùng tông + icon |
| `Card` | `components/ui` | `surface` + viền `rule` |
| `Skeleton` | `components/ui` | Khi đang tải |
| `ConnectButton`, `NetworkGuard` | `components/wallet` | Xem ui-pages §2 |
| `DisclaimerBanner` | `components/layout` | Luôn hiện, không đóng được |
| `TxLink` | `components/ui` | Hash rút gọn `0x12ab…cdef` + icon ↗, font mono, mở tab mới |
| `Address` | `components/ui` | Rút gọn + nút sao chép |

## 4. Pattern riêng AskPay

### 4.1 `StatusBadge`

| Trạng thái | Nhãn | Màu | Icon (lucide) |
|---|---|---|---|
| Đang xử lý | ĐANG XỬ LÝ | `pending` | `loader-circle` (xoay) |
| Paid | ĐÃ THANH TOÁN | `paid` | `badge-check` |
| Refunded | ĐÃ HOÀN TIỀN | `refund` | `rotate-ccw` |
| Quá hạn | QUÁ HẠN | `expired` | `clock-alert` |

Nhãn viết hoa, chữ đậm 12px, có khoảng cách chữ. Bên cạnh badge luôn có số tiền và link tx.

### 4.2 `StepTimeline`

Bốn bước ngang (dọc trên mobile): **Giữ tiền → Trả lời → Kiểm tra → Chốt**. Bước xong có ✓ màu `paid`; bước đang chạy có chấm `pending` nhấp nháy; bước chưa tới màu `rule`. Vùng `aria-live="polite"` đọc tên bước hiện tại.

### 4.3 `CitationCard`

```
┃ Điều 25 · Khoản 2 — Thời gian thử việc          ← sans, đậm
┃ “không quá 60 ngày đối với công việc …”         ← serif, nghiêng
┃ ✓ Khoản có trong luật đã đăng ký on-chain       ← paid, dòng chính
┃   Đoạn trích và mức liên quan: checker đã ký    ← dòng phụ, chữ nhỏ, bắt buộc đi kèm
┃                               Xem nguyên văn ▾  ← link
```

- Viền trái 3px màu `seal`, giống lề công báo.
- "Xem nguyên văn" mở ra toàn văn Khoản (serif) và **tô nền nhạt đúng đoạn được trích**.
- Dấu ✓ chỉ hiện khi `verifiedOnChain = true` (Paid và hash khớp event). Không bao giờ hiện dòng chính mà thiếu dòng phụ. Khi bị hoàn tiền, viền chuyển `refund` và không có dấu ✓.

### 4.4 `PriceTag`

`0,05 USDC` (đậm) + `≈ 1.300đ` (muted). Dùng dấu phẩy thập phân kiểu Việt Nam. Quy đổi VND là ước lượng cố định ghi trong `lib/format.ts`, có chú thích "ước tính".

### 4.5 `RefundNotice`

Khung nền `refund` nhạt, icon `rotate-ccw`, câu lý do lấy từ `packages/shared`, link tx hoàn tiền.

## 5. Trạng thái và a11y

- Mọi thứ thao tác được bằng bàn phím; focus luôn nhìn thấy (`--color-focus`).
- Màu không bao giờ là tín hiệu duy nhất: luôn có chữ + icon.
- Nút có nhãn rõ ("Ký và trả 0,05 USDC", không chỉ "Tiếp").
- Hash và địa chỉ có `title` chứa giá trị đầy đủ.
- Thông báo lỗi gắn với ô nhập bằng `aria-describedby`.

## 6. Cấm

- Gradient, neon, hình nền "crypto", icon coin xoay.
- Màu đỏ cho trạng thái hoàn tiền.
- Hiện "Đã thanh toán", "Đã xác minh" hoặc dấu ✓ trước khi có event on-chain.
- Số tiền dạng số thực hoặc làm tròn sai (`0.049999`).
- Chữ có chân ngoài phần trích dẫn luật.
- Ẩn disclaimer.
- Emoji trong giao diện sản phẩm (tài liệu thì được).

## 7. Ví dụ

| Tình huống | Đúng | Sai |
|---|---|---|
| Câu bị hoàn vì trích sai | Badge hổ phách "ĐÃ HOÀN TIỀN", khung cảnh báo, câu trả lời mờ đi | Badge đỏ "LỖI", hoặc ẩn hết không giải thích |
| Đang chờ chốt | "Đang chốt…" + spinner | "Đã thanh toán" trước khi có receipt |
| Hiển thị tiền | `0,05 USDC` | `0.05000000 USDC`, `50000` |

## 8. Triển khai

- Token trong `globals.css`. Component dùng class Tailwind theo token (`bg-paper`, `text-ink`, `border-rule`).
- Font tải bằng `next/font` (subset `vietnamese`).
- Icon: `lucide-react`.
- Kiểm tra trước khi merge: chạy Lighthouse a11y ≥ 90 trên trang Hỏi và trang Kết quả.
