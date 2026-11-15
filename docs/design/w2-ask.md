# W2 — `useAsk` và trang Hỏi

> **Trạng thái:** đã duyệt (15/11/2026): owner chốt U-05..U-09 theo đề xuất. Ticket W2 ([tasks.csv](../runbook/tasks.csv)), hạn 16/11. Phụ thuộc W1 (PR #17) và A5 (PR #15).
> Nguồn: [ui-pages §1.1, §3](../product/ui-pages.md#3--hỏi), [design-system](../product/design-system.md), [frontend convention](../conventions/frontend.md), [api.md §3](../architecture/api.md#3-post-apiask), [system-design T-07, §5.6](../architecture/system-design.md), [W1 §3.5, §5](./w1-web-shell.md), spec AP-02, AP-03, AP-07-AC03.
> Tài liệu này không đổi hành vi trong spec, không đổi API. Hai chỗ lệch giữa các tài liệu được nêu ở §13 để owner chốt.

## 1. Người dùng và việc cần làm

- **Ai:** người hỏi đã kết nối ví ở W1. Lần đầu gặp x402 nên cần thấy **giá trước khi ví bật lên** (AP-02-AC03) và hiểu rằng ký chưa phải là mất tiền.
- **Việc ở W2:** gõ câu hỏi → bấm "Hỏi" → thấy giá → bấm "Ký và trả 0,05 USDC" → ký trong ví → thấy tiến trình → tới khi tiền đã vào escrow thì sang `/questions/<qid>`.
- **Xong khi** (ticket): hỏi được từ trình duyệt tới `PAID`.
- **Không thuộc W2:** thẻ trích dẫn, `StatusBadge`, `TxLink`, cảnh báo hoàn tiền (W3); `claimRefund` (W5); dashboard (W4).

## 2. Bố cục và cây file

```
┌──────────────────────────────────────────────────┐
│ Hỏi về Bộ luật Lao động 2019                      │  h1 (đã có ở W1)
│ Trả theo câu. Không qua kiểm tra thì hoàn tiền.   │
│ ┌──────────────────────────────────────────────┐ │
│ │ Ví dụ: Thử việc tối đa bao lâu?              │ │  QuestionForm: textarea
│ └──────────────────────────────────────────────┘ │
│ Câu hỏi tối đa 500 ký tự              123/500    │  lỗi (nếu có) · bộ đếm
│ Gợi ý: [Thử việc] [Làm thêm giờ] [Nghỉ việc]      │  SampleChips
│ ┌ 0,05 USDC  ≈ 1.300đ (ước tính) ─────────────┐ │  PriceNotice (chỉ khi có báo giá)
│ │ Tiền vào escrow, không vào ví của AskPay.    │ │
│ │ Không qua kiểm tra thì contract hoàn tiền.   │ │
│ │ Báo giá còn 4:12                              │ │
│ └──────────────────────────────────────────────┘ │
│ (dòng thông báo: huỷ ký / thiếu USDC / lỗi)       │  AskNotice, aria-live
│                         [ Ký và trả 0,05 USDC ]  │  AskButton
│ ✓ Đã ký  ● Đang giữ tiền  ○ Trả lời  ○ Kiểm tra … │  StepTimeline (sau khi gửi chữ ký)
└──────────────────────────────────────────────────┘
```

| File | Vai trò |
|---|---|
| `app/page.tsx` | Mỏng: h1, tagline, `<AskForm />` |
| `app/questions/[qid]/page.tsx` | **Tuỳ U-05.** Bản tối thiểu cho W2: câu hỏi + `StepTimeline` + dòng trạng thái |
| `features/ask/components/AskForm.tsx` | Ghép form, giá, thông báo, nút, timeline; chỉ đọc state của `useAsk` |
| `features/ask/components/QuestionForm.tsx`, `SampleChips.tsx`, `PriceNotice.tsx`, `AskButton.tsx`, `AskNotice.tsx`, `StepTimeline.tsx` | |
| `features/ask/hooks.ts` | `useAsk` (§3), `useQuestionProgress(qid)` (poll `GET /questions/:qid`, §8) |
| `features/ask/api.ts` | `requestQuote`, `submitPayment`, `getQuestion`: gọi `lib/api.ts`, trả kiểu từ `@askpay/shared` |
| `features/ask/payment.ts` | Hàm thuần: dựng typed data và header `PAYMENT-SIGNATURE` (§5), kiểm hạn báo giá (§6) |
| `features/ask/messages.ts` | Chuỗi ở §11 |
| `lib/api.ts` | **Client API duy nhất** (§4) |
| `lib/format.ts` | Thêm `formatVndEstimate(units)` (§7) |
| `next.config.ts` | Thêm rewrite `/api/*` và `proxyTimeout` (§9) |

`StepTimeline` nằm ở `features/ask`, vì convention cấm import chéo feature và trang kết quả W3 cũng thuộc `features/ask` (cây ở frontend convention §1).

## 3. Máy trạng thái `useAsk`

```ts
type AskState =
  | { kind: 'editing' }                                   // chưa có báo giá
  | { kind: 'quoting'; question: string }
  | { kind: 'quoted'; question: string; quote: Quote; notice?: QuotedNotice }
  | { kind: 'signing'; question: string; quote: Quote }
  | { kind: 'submitting'; question: string; quote: Quote; payment: SignedPayment; stage?: Stage }
  | { kind: 'unsure'; question: string; quote: Quote; payment: SignedPayment; stage?: Stage }
  | { kind: 'failed'; question: string; error: AskError }  // bị từ chối trước khi giữ tiền
  | { kind: 'redirecting'; qid: Hex };

type Quote = { requirement: PaymentRequirement; receivedAt: number; expiresAt: number; validBeforeAt: number }; // accepts[0] nguyên văn; hai mốc giờ tính trên đồng hồ máy, từ lúc nhận báo giá (§6.5)
type SignedPayment = { qid: Hex; header: string };                    // base64, gửi lại được y hệt
type QuotedNotice = { kind: 'signRejected' | 'signFailed' | 'walletPending' | 'chainBusy' | 'rateLimited' } | { kind: 'insufficient'; balance: bigint; price: bigint }; // `quoted` có thêm `payment?` khi bị 503/429: nút "Thử lại" gửi lại header đó
```

Hook là `useAsk(draft)` (`draft` là chữ đang gõ), trả `{ state, check, locked, button, notice, ask(), pay(), retrySend(), reset() }`. `button` (nhãn, vô hiệu, hành động) và `notice` suy ra theo §3.2 trong `ask-view.ts` (hàm thuần). `ask()` đọc `draft` hiện tại. `reset()` chỉ có tác dụng ở trạng thái chưa giao chữ ký cho server. Component không tự suy luận trạng thái.

### 3.1 Chuyển trạng thái

| Từ | Sự kiện | Sang |
|---|---|---|
| `editing` | `ask()` với câu hợp lệ và ví `ready` | `quoting` |
| `quoting` | 402 báo giá hợp lệ | `quoted` |
| `quoting` | 400 / 429 / lỗi mạng / 5xx | `failed` (câu hỏi giữ nguyên) |
| `quoted` | `pay()` và đủ USDC (§7) | `signing` |
| `signing` | ví trả chữ ký | `submitting` (gửi POST lần 2 ngay) |
| `signing` | từ chối ký (4001) | `quoted` + `signRejected` |
| `signing` | lỗi ví khác | `quoted` + thông báo lỗi ví (dùng `classifyWalletError` của W1) |
| `submitting` | 200, 202, 409 `QUESTION_ALREADY_SETTLED`, hoặc poll thấy tiền đã vào (§6.2) | `redirecting` |
| `submitting` | bị từ chối trước khi giữ tiền (§6.1, nhóm A) | `failed` hoặc `quoted` + notice |
| `submitting` | lỗi mạng, hết giờ, 5xx, phản hồi không đọc được (nhóm B) | `unsure` |
| `unsure` | poll thấy tiền đã vào | `redirecting` |
| `unsure` | poll thấy `QUOTED`, báo giá còn hạn | ở lại, hiện nút "Gửi lại" (`retrySend()` gửi **đúng header cũ**) |
| `unsure` | poll thấy `QUOTED`/`EXPIRED` và `validBefore` đã qua | `failed` với `signatureExpired` (§6.3) |
| `quoted` | sửa câu hỏi, đổi `address` hoặc `chainId`, hoặc báo giá hết hạn (§6) | `editing` (hết hạn thì nút thành "Lấy giá mới") |

**Bất biến:**
- Từ lúc có `SignedPayment`, UI **không bao giờ** mời lấy báo giá mới cho tới khi chain chắc chắn chưa giữ tiền (AP-03-AC06). Không có nút "Hỏi lại", không reset form.
- Trong `signing`, `submitting`, `unsure`: textarea `readOnly`, chip vô hiệu.
- Đổi `address` hoặc `chainId` **trong `signing`** (ví chưa trả chữ ký): bỏ chữ ký nếu sau đó ví trả về, không gửi, về `editing` (giao ước W1 §3.5). Ở `submitting` và `unsure` thì đổi ví hay đổi mạng **không** huỷ gì: chữ ký đã được gửi tới server.
- POST lần 2 **không** gắn `AbortController` huỷ khi unmount. Request chạy tới khi server trả lời; trang kết quả tự poll.
- Mỗi lúc chỉ một luồng `ask` (nút vô hiệu khi đang chạy; `ask()` gọi lặp bị bỏ qua).

### 3.2 Nút và thông báo (khớp ui-pages §3.1)

| Điều kiện | Nút | Thông báo |
|---|---|---|
| Ví `loading` | Skeleton cùng cỡ nút | — |
| Ô trống (sau chuẩn hoá) | "Hỏi", vô hiệu | — |
| Quá 500 ký tự | "Hỏi", vô hiệu | "Câu hỏi tối đa 500 ký tự" dưới ô |
| `disconnected` | "Kết nối ví để hỏi" → `openConnectDialog()` | — |
| `connecting` | "Đang kết nối…", vô hiệu | — |
| `wrongNetwork` | "Chuyển sang Fuji" → `switchChain` (cùng hàm NetworkGuard) | thanh NetworkGuard |
| `editing`, ví `ready` | "Hỏi" | — |
| `quoting` | Spinner "Đang lấy giá…", vô hiệu | — |
| `quoted`, đủ USDC | "Ký và trả 0,05 USDC" | PriceNotice |
| `quoted`, thiếu USDC | Vô hiệu | "Số dư 0,01 USDC, cần 0,05 USDC." + "Lấy USDC testnet ↗" (AP-03-AC05) |
| `quoted`, chưa đọc được số dư | "Ký và trả 0,05 USDC" (bật) | — (server kiểm lại, §7) |
| `signing` | "Xác nhận trong ví…", vô hiệu | "Ví sẽ hỏi bạn ký uỷ quyền chuyển 0,05 USDC vào escrow." |
| `quoted` + `signRejected` | "Ký và trả 0,05 USDC" | "Bạn đã huỷ ký. Câu hỏi vẫn còn đây." (màu `ink-muted`) |
| `submitting` | "Đang gửi…", vô hiệu | StepTimeline |
| `unsure` | Vô hiệu (hoặc "Gửi lại" nếu poll thấy `QUOTED`) | "Đang kiểm tra thanh toán trên blockchain. Đừng ký lại." + link "Mở trang câu hỏi" |
| Báo giá hết hạn | "Lấy giá mới" | — |
| `failed` | Theo §6.1 | Câu lỗi của mã đó |

Nhãn "Ký và trả …" lấy số tiền từ `quote.requirement.amount`, không viết cứng 0,05.

## 4. `lib/api.ts`

Một client, cùng origin, đọc envelope. Không component nào gọi `fetch`.

```ts
type ApiResult<T> =
  | { kind: 'data'; status: 200 | 202; data: T; headers: Headers }
  | { kind: 'paymentRequired'; body: PaymentRequired }            // 402 báo giá: body x402 trần
  | { kind: 'error'; status: number; code: ErrorCode; message: string; details?: unknown }
  | { kind: 'network'; cause: unknown }                            // fetch reject, timeout
  | { kind: 'malformed'; status: number };                         // không khớp schema nào
```

- **Hai loại 402.** 402 báo giá là JSON x402 trần (`paymentRequiredSchema`), không bọc envelope. 402 `PAYMENT_INVALID` nằm trong `{ error }`. Client thử `paymentRequiredSchema` trước, rồi `errorEnvelopeSchema`.
- `INSUFFICIENT_BALANCE` nhận ra bằng `insufficientBalanceDetailsSchema.safeParse(details)`.
- `409 QUESTION_ALREADY_SETTLED`: `details` có thể là kết quả hiện tại hoặc không có. Điều hướng luôn theo `qid` client đang giữ.
- `message` hiển thị lấy từ `ERROR_CODES[code].message` của shared, không dùng chuỗi server gửi (hai bên cùng nguồn, nhưng web không tin dữ liệu từ mạng để hiển thị).
- Phản hồi không parse được: `malformed`. Với POST lần 2, `malformed` được xử lý như `network` (chưa biết kết quả).
- Timeout phía client cho POST lần 2: 90 giây (dài hơn 60 giây server giữ + `proxyTimeout` §9). Hết giờ thì `network`, sang `unsure`. **Không** huỷ request khi unmount.

## 5. Ký (EIP-3009)

`features/ask/payment.ts`, hàm thuần, test được không cần ví:

```ts
buildAuthorization(requirement, payer) =
  { from: payer, to: requirement.payTo, value: BigInt(amount), validAfter: 0n,
    validBefore: BigInt(extra.validBefore), nonce: extra.qid }
typedData = receiveAuthorizationTypedData({ tokenName, tokenVersion, asset, authorization })
header = encodeHeader({ x402Version: 2, accepted: requirement, payload: { signature, authorization } })
```

- Chỉ dùng `receiveAuthorizationTypedData` và `encodeHeader` của shared. Không khai lại types EIP-712.
- `accepted` là `accepts[0]` **y nguyên** như nhận được; không dựng lại từng trường.
- Trước khi mở ví, kiểm `requirement` khớp những gì web biết, không khớp thì `failed` với `quoteMismatch` (không mở ví):
  - `network === FUJI_NETWORK`, `asset === fujiDeployment.token`, `payTo === fujiDeployment.address` (so chữ thường).
  - `amount` dương.
  Lý do: chữ ký chuyển tiền cho `payTo`; web không ký cho địa chỉ mà repo không công bố.
- Ký bằng `signTypedData` của wagmi với `account = address` của `useWalletStatus` lúc bấm, khi ví `ready`. `from` lấy từ đó, không lấy từ ví sau khi ký.
- Domain có `chainId: 43113`; ví ở sai mạng thì nút đã là "Chuyển sang Fuji", nên không tới được bước ký.

## 6. Báo giá và kết quả sau khi gửi chữ ký

### 6.1 Phân nhóm phản hồi của POST lần 2

Đối chiếu với `ask.service.ts` (A5): mọi lỗi dưới đây được ném **trước khi** có tiền trong escrow; riêng hai lỗi có dấu * xảy ra sau khi server đã thử deposit nhưng chain báo chưa giữ tiền (server đưa câu về `QUOTED`).

| Nhóm | Phản hồi | UI |
|---|---|---|
| **A** | `400 VALIDATION_FAILED` | `failed` + câu lỗi; nút "Hỏi" |
| A | `404 QUESTION_NOT_FOUND` (báo giá hết hạn/không có) | `editing`, nút "Lấy giá mới", thông báo "Báo giá đã hết hạn, bạn chưa bị trừ tiền." |
| A | `409 QUESTION_MISMATCH` | `failed` + câu lỗi (không nên xảy ra, §6.4) |
| A | `402 PAYMENT_INVALID` + `INSUFFICIENT_BALANCE` | `quoted` + `insufficient`, dùng `balance`/`price`/`faucetUrl` từ `details` |
| A | `402 PAYMENT_INVALID` khác (kể cả `DEPOSIT_FAILED`*) | `failed`, nút "Lấy giá mới" (U-07) |
| A | `503 CHAIN_UNAVAILABLE` (kể cả RPC sập lúc deposit*) | `quoted` + `chainBusy`, nút "Thử lại" = `retrySend()` gửi **lại đúng header cũ** khi báo giá còn hạn; hết hạn thì "Lấy giá mới". Câu chữ: U-06 |
| A | `429 RATE_LIMITED` | Như 503 nhưng câu của 429 |
| **B** | `200` | `redirecting` |
| B | `202 { qid, stage }` (kể cả `DEPOSITING`) | `redirecting`: server đã nhận và tự đối chiếu, trang kết quả poll tiếp |
| B | `409 QUESTION_ALREADY_SETTLED` | `redirecting` tới `qid` của `SignedPayment` (không dựa vào `details`: nhánh hai request song song ở A5 có thể trả `details` rỗng) |
| **C** | lỗi mạng, hết giờ, `500`, `502`/`504` của proxy, `malformed` | `unsure` (§6.2) |

Gửi lại đúng header cũ (`retrySend`) an toàn vì nonce = qid: server chỉ cho một request giành stage, và contract không nhận cùng nonce hai lần (AP-03-AC03).

### 6.2 Poll song song và điều hướng (AP-03-AC06, AP-07-AC03)

- Ngay khi gửi POST lần 2, `useAsk` poll `GET /api/questions/<qid>` mỗi 1 giây (T-07) để cập nhật `stage` cho StepTimeline.
- **Điều hướng `router.push('/questions/<qid>')` khi tiền chắc chắn đã vào hoặc server đã nhận việc:** POST trả nhóm B, **hoặc** poll thấy `stage ∈ {ANSWERING, CHECKING, SETTLING, PAID, REFUNDED}`, **hoặc** `status` đã đóng (`PAID`, `REFUNDED`, `CLAIMABLE`). `status = PENDING` không tính: A6 trả `PENDING` ngay từ `DEPOSITING`.
- **Không** điều hướng khi poll mới thấy `DEPOSITING`: server còn có thể đưa câu về `QUOTED` rồi trả 503 hoặc `PAYMENT_INVALID` (`backToQuoted` ở A5). Ở lại để hiện lỗi nhóm A tại chỗ, câu hỏi vẫn còn.
- Ở `unsure`: tiếp tục poll (1 giây, sau 30 giây giãn ra 3 giây). GET lỗi thì giữ `unsure`, không kết luận gì.
- Sau khi điều hướng, POST vẫn chạy nền; kết quả của nó bị bỏ qua (trang kết quả là nguồn hiển thị). Khi POST xong hoặc khi điều hướng, invalidate query số dư của W1.
- Nhãn "Đã thanh toán", "Đã chốt", "Đã hoàn tiền" không xuất hiện ở trang Hỏi. Trang Hỏi chỉ hiện các bước đang chạy (§8).

### 6.3 Khi nào được mời báo giá mới

Chỉ khi một trong hai điều sau đúng:
1. Server trả lỗi nhóm A (chain chưa giữ tiền).
2. Ở `unsure`, poll thấy `QUOTED` hoặc `EXPIRED` **và** đã qua `validBefore` của chữ ký (theo đồng hồ đã hiệu chỉnh ở §6.5). Sau `validBefore`, `receiveWithAuthorization` không chạy được nữa, nên chắc chắn không bị trừ tiền. Thông báo: "Chữ ký đã hết hạn và bạn chưa bị trừ tiền. Hãy lấy giá mới."

### 6.4 Câu hỏi giống hệt giữa hai lần gọi (AP-03-AC04)

- `useAsk` chuẩn hoá một lần: `question.normalize('NFC').trim()`, giống `askRequestSchema`. Lưu chuỗi đã chuẩn hoá cùng báo giá và gửi **đúng chuỗi đó** ở lần 2.
- Bộ đếm `n/500` và lỗi độ dài đếm trên chuỗi đã chuẩn hoá, giới hạn lấy `MAX_QUESTION_LENGTH` của shared. Kiểm bằng `askRequestSchema.safeParse` để khớp server.
- **Sửa textarea khi đang giữ báo giá thì huỷ báo giá** (về `editing`, ẩn PriceNotice). Đây là điều kiện thứ ba, thêm vào giao ước W1 §3.5 (đổi `address` hoặc `chainId`).

### 6.5 Hạn báo giá

- Server từ chối chữ ký có `validBefore < now + 60s` (`MIN_VALID_BEFORE_SECONDS`). Client coi báo giá **hết hạn sớm hơn 90 giây**: 60 giây của server + 30 giây cho popup ví và đường mạng.
- Không tin đồng hồ máy người dùng: hạn tính theo thời điểm nhận báo giá, `expiresAt = receivedAt + (validBefore − serverNow) − 90s`, với `serverNow` lấy từ header `Date` của 402. Không có `Date` thì dùng `receivedAt + maxTimeoutSeconds − 90s`.
- PriceNotice hiện "Báo giá còn m:ss" (cập nhật mỗi giây, **không** `aria-live` để khỏi đọc liên tục; chỉ thông báo một lần khi còn 30 giây và khi hết hạn).
- Hết hạn ở `quoted` → nút "Lấy giá mới". Hết hạn ở `signing` (ví đang mở) → khi ví trả chữ ký, không gửi; báo "Báo giá đã hết hạn trong lúc ký, bạn chưa bị trừ tiền." và về "Lấy giá mới".

## 7. Giá và số dư (AP-02-AC03, AP-03-AC05)

- PriceNotice: `formatUsdcVi(amount)` + " USDC" (đậm) và `≈ 1.300đ (ước tính)` (muted), theo design-system §4. `formatVndEstimate` dùng hằng `USDC_VND_ESTIMATE = 26_000n` trong `lib/format.ts`, làm tròn tới 100đ, tính bằng `bigint`. Đã có chỗ ghi ở design-system nên không mở câu hỏi mới.
- PriceNotice hiện **trước** khi ví được gọi; ví chỉ mở khi người dùng bấm nút thứ hai.
- So số dư từ `useWalletStatus().usdc` với `amount`:
  - `usdc < amount`: nút vô hiệu, hiện dòng thiếu tiền + link faucet `FAUCET_URL` (cùng link AccountMenu). Không ký, không gửi gì.
  - `usdc === undefined` (đang tải hoặc lỗi): cho ký; server kiểm lại và trả `INSUFFICIENT_BALANCE` nếu thiếu (nhóm A). Không chặn người dùng vì một lần đọc RPC lỗi.
  - Số dư thay đổi (vừa xin faucet, refetch khi focus) thì nút tự bật lại.

## 8. Tiến trình: `StepTimeline` và `useQuestionProgress`

Bốn bước theo AP-07-AC03, ánh xạ từ `stage`:

| Bước | Đang chạy khi | Xong khi |
|---|---|---|
| 1. Giữ tiền | `DEPOSITING` (hoặc vừa gửi chữ ký) | `stage ≥ ANSWERING` |
| 2. Trả lời | `ANSWERING` | `stage ≥ CHECKING` |
| 3. Kiểm tra | `CHECKING` | `stage ≥ SETTLING` |
| 4. Chốt | `SETTLING` | có `status ∈ {PAID, REFUNDED}` **và** `tx.settle` |

- Nhãn bước dùng động từ trung tính ("Giữ tiền", "Trả lời", "Kiểm tra", "Chốt"). Chữ "Đã thanh toán", "Đã hoàn tiền" và dấu ✓ xác minh **không** thuộc timeline; chúng là việc của `StatusBadge` ở W3 và chỉ dựa trên `status` (P2).
- Câu hỏi bị hoàn tiền ở bước 2 (`ANSWER_FAILED`, `NO_CITATION`) nhảy thẳng tới `REFUNDED`: các bước bỏ qua hiện "—" (bỏ qua), không hiện ✓.
- **`stage` lùi** (`DEPOSITING → QUOTED` sau khi server khởi động lại, system-design §5.6 D): timeline không quay về trạng thái trống mà hiện bước 1 "Chưa giữ tiền" và để `useAsk` xử lý như §6.3.
- `useQuestionProgress(qid)`: TanStack Query, `refetchInterval` 1 giây khi chưa chốt, dừng khi có `status ∈ {PAID, REFUNDED, CLAIMABLE}`. W3 dùng lại hook này.
### 8.1 Route tối thiểu `/questions/[qid]` (nếu owner chọn U-05 như đề xuất)

Người dùng có thể tới đây khi tiền chưa chắc đã vào (202 `DEPOSITING`, 409, ra khỏi `unsure`), và recovery có thể đưa câu về `QUOTED` hoặc `EXPIRED`. Trang phải có chỗ cho mọi trường hợp:

| Dữ liệu | Hiển thị ở W2 |
|---|---|
| `stage ∈ {QUOTED, EXPIRED}`, không có `status` | "Chưa giữ tiền. Bạn chưa bị trừ tiền." + link "Về trang Hỏi". Dừng poll khi `EXPIRED` |
| `status = PENDING` | Câu hỏi + timeline, poll tiếp |
| `status ∈ {PAID, REFUNDED}` | Timeline đủ bước + dòng chữ theo `status` (W3 thay bằng `StatusBadge`, thêm câu trả lời) |
| `status = CLAIMABLE` | "Đã quá 10 phút mà chưa có kết quả." Không có nút ở W2 (`claimRefund` là W5) |
| `404 QUESTION_NOT_FOUND` | "Không tìm thấy câu hỏi này." + "Về trang Hỏi" |
| Lỗi tải (mạng, 5xx) | "Không tải được kết quả." + "Thử lại" (khác 404) |

Chữ trạng thái chỉ lấy từ `status`, không từ `stage`.

### 8.2 A11y của timeline

- Danh sách `<ol>`, mỗi bước có chữ trạng thái ("đang chạy", "xong", "bỏ qua") cho trình đọc màn hình, không chỉ icon/màu. Một vùng `aria-live="polite"` đọc tên bước mới khi đổi bước, không đọc mỗi lần poll.

## 9. Rewrite `/api` và giới hạn thời gian của proxy

- `next.config.ts` hiện **chưa có rewrite**, dù setup-and-bringup đã ghi `API_ORIGIN`. W2 thêm `rewrites: [{ source: '/api/:path*', destination: `${API_ORIGIN}/api/:path*` }]`; thiếu `API_ORIGIN` thì build báo lỗi rõ ràng (không ngầm trỏ `localhost`).
- **Đã kiểm 15/11/2026:** proxy rewrite của Next 16.4.6 cắt request sau **30 giây** mặc định (`proxyTimeout || 30000` trong `next/dist/server/lib/router-utils/proxy-request.js`). Server giữ POST tới 60 giây (`REQUEST_WAIT_MS`). Không chỉnh thì mọi câu trả lời chậm hơn 30 giây đều thành lỗi phía client giữa lúc đã giữ tiền.
- Cách xử lý, cả hai cùng làm:
  1. Đặt `experimental.proxyTimeout: 75_000` (60 giây + biên). Khoá này nằm trong `experimental` ở 16.4.6 (`experimentalSchema` trong `next/dist/server/config-schema.js`, dòng 338); đặt sai chỗ thì Next bỏ qua âm thầm và quay về 30 giây, nên test cấu hình đọc lại giá trị.
  2. Dù proxy có cắt, `useAsk` đã coi lỗi đó là nhóm C (`unsure`) và đi poll, nên không bao giờ mời trả lần hai.
- **Chưa kiểm:** giới hạn thời gian rewrite ra origin ngoài khi deploy Vercel (O1, 19/11). `proxyTimeout` chỉ áp dụng cho `next start`/`next dev`. Khi deploy, đo bằng một câu thật; nếu Vercel cắt sớm hơn 60 giây thì điểm 2 vẫn giữ đúng hành vi, chỉ là người dùng sang `unsure` rồi được điều hướng sau vài giây.
- **Chưa kiểm (O1):** rewrite thêm một proxy trước API. Vercel + Render là hai lớp proxy trong khi `TRUST_PROXY_HOPS=1`, nên mọi người dùng có thể chung một giới hạn 20 báo giá mỗi phút. Đo khi deploy; sửa bằng `TRUST_PROXY_HOPS`, không sửa ở web.
- **Chưa kiểm:** header `Date` của 402 có đi qua proxy nguyên vẹn không (§6.5 có đường dự phòng `maxTimeoutSeconds`).

## 10. Tương tác và a11y

- Textarea có `<label>` thấy được ("Câu hỏi của bạn"), `aria-describedby` trỏ tới bộ đếm và dòng lỗi. Bộ đếm cập nhật âm thầm; chỉ khi vượt 500 thì lỗi được đọc (`role="alert"` không dùng; dùng `aria-live="polite"`).
- Ctrl/⌘ + Enter trong textarea = bấm nút chính (chỉ khi nút bật).
- Chip gợi ý là `<button>`; bấm thì điền câu mẫu đầy đủ vào ô (huỷ báo giá nếu có, như sửa tay) và đưa focus về textarea.
- Khi có báo giá, focus chuyển sang nút "Ký và trả …" (người dùng bàn phím không phải Tab tìm). Khi bị từ chối ký, focus ở lại nút.
- `AskNotice` là một vùng `aria-live="polite"` duy nhất cho mọi thông báo của form. Lỗi chặn (nhóm A) dùng màu `error` + icon; huỷ ký dùng `ink-muted` (không phải lỗi).
- Màn 360px: nút chính rộng hết hàng; PriceNotice xuống dòng, số tiền không bị cắt.

## 11. Chuỗi giao diện (`features/ask/messages.ts`)

```
questionLabel: 'Câu hỏi của bạn'           placeholder: 'Ví dụ: Thử việc tối đa bao lâu?'
tooLong: 'Câu hỏi tối đa 500 ký tự'          samplesLabel: 'Gợi ý:'
samples: Thử việc → 'Thời gian thử việc tối đa với công việc cần bằng cao đẳng là bao lâu?'
         Làm thêm giờ → 'Mỗi tháng được làm thêm tối đa bao nhiêu giờ?'
         Nghỉ việc → 'Muốn nghỉ việc thì phải báo trước bao nhiêu ngày?'
ask: 'Hỏi'   connectToAsk: 'Kết nối ví để hỏi'   switchToFuji: 'Chuyển sang Fuji'
quoting: 'Đang lấy giá…'   pay: (amount) => `Ký và trả ${amount} USDC`   newQuote: 'Lấy giá mới'
confirmInWallet: 'Xác nhận trong ví…'   sending: 'Đang gửi…'   retry: 'Thử lại'   resend: 'Gửi lại'
vndEstimate: (vnd) => `≈ ${vnd}đ (ước tính)`
escrowNote: 'Tiền vào escrow, không vào ví của AskPay.'
refundNote: 'Không qua kiểm tra thì contract hoàn tiền.'
quoteCountdown: (mmss) => `Báo giá còn ${mmss}`
signHint: (amount) => `Ví sẽ hỏi bạn ký uỷ quyền chuyển ${amount} USDC vào escrow.`
signRejected: 'Bạn đã huỷ ký. Câu hỏi vẫn còn đây.'
insufficient: (balance, price) => `Số dư ${balance} USDC, cần ${price} USDC.`
getTestUsdc: 'Lấy USDC testnet'
quoteExpired: 'Báo giá đã hết hạn, bạn chưa bị trừ tiền.'
expiredWhileSigning: 'Báo giá đã hết hạn trong lúc ký, bạn chưa bị trừ tiền.'
quoteMismatch: 'Báo giá không khớp contract đã công bố. AskPay không mở ví.'
unsure: 'Đang kiểm tra thanh toán trên blockchain. Đừng ký lại.'
openQuestion: 'Mở trang câu hỏi'
signatureExpired: 'Chữ ký đã hết hạn và bạn chưa bị trừ tiền. Hãy lấy giá mới.'
steps: 'Giữ tiền' · 'Trả lời' · 'Kiểm tra' · 'Chốt'   stepState: 'đang chạy' · 'xong' · 'bỏ qua' · 'chưa tới'
notHeld: 'Chưa giữ tiền'
```

Câu lỗi theo mã (`PAYMENT_INVALID`, `RATE_LIMITED`, `CHAIN_UNAVAILABLE`, …) lấy từ `ERROR_CODES` của shared, không chép vào đây.

## 12. Ví dụ chấp nhận

`useAsk` test bằng connector `mock` của wagmi (harness W1) và API giả lập ở mức `fetch` (MSW hoặc `vi.fn`, chọn lúc cài đặt; không thêm thư viện nếu `vi.fn` đủ).

| Mã | Cho / Khi / Thì | Kiểm bằng |
|---|---|---|
| W2-E01 (AP-02-AC01, AP-02-AC03) | Ví `ready`, gõ câu hợp lệ, bấm "Hỏi" → 402 → thấy `0,05 USDC ≈ 1.300đ (ước tính)` và nút "Ký và trả 0,05 USDC"; **chưa** có lệnh `signTypedData` nào | Vitest |
| W2-E02 (AP-02-AC02) | Ô trống, chỉ khoảng trắng, hoặc 501 ký tự sau NFC → nút vô hiệu, hiện "Câu hỏi tối đa 500 ký tự" khi quá dài; không có request nào | Vitest |
| W2-E03 | Chuỗi tổ hợp (NFD) 500 ký tự sau NFC → hợp lệ; lần 2 gửi đúng chuỗi NFC đã lưu (so body hai request) | Vitest |
| W2-E04 (AP-03-AC01) | Ký → POST lần 2 có header `PAYMENT-SIGNATURE` giải mã ra `nonce = qid`, `validAfter = 0`, `to = payTo`, `accepted` y hệt `accepts[0]` → 200 → điều hướng `/questions/<qid>`; số dư được invalidate | Vitest |
| W2-E05 | Từ chối ký (4001) → về báo giá, "Bạn đã huỷ ký. Câu hỏi vẫn còn đây.", không có POST lần 2 | Vitest (`mock` từ chối `signTypedData`) |
| W2-E06 (AP-03-AC05) | Số dư mock 10000n, giá 50000 → nút vô hiệu, "Số dư 0,01 USDC, cần 0,05 USDC." + link faucet; không ký, không POST lần 2 | Vitest |
| W2-E07 (AP-03-AC05) | Số dư `undefined`, server trả 402 `INSUFFICIENT_BALANCE` → hiện cùng dòng thiếu tiền từ `details` | Vitest |
| W2-E08 (AP-03-AC06) | POST lần 2 lỗi mạng; poll trả `DEPOSITING` rồi `ANSWERING` → `unsure` ("Đừng ký lại", không có nút báo giá mới) rồi điều hướng | Vitest |
| W2-E09 (AP-03-AC06) | POST lần 2 trả 202 `DEPOSITING` → điều hướng ngay, không có 402 hay báo giá mới | Vitest |
| W2-E10 | Poll thấy `DEPOSITING`, rồi POST trả 503 → **không** điều hướng; ở lại với "Thử lại"; bấm → gửi lại **đúng header cũ** (so byte) | Vitest |
| W2-E11 | `unsure`, poll `QUOTED`, đồng hồ giả qua `validBefore` → "Chữ ký đã hết hạn và bạn chưa bị trừ tiền" + "Lấy giá mới" | Vitest (fake timers) |
| W2-E12 | Có báo giá, sửa một ký tự / đổi tài khoản / đổi chain → PriceNotice biến mất, nút về "Hỏi" | Vitest |
| W2-E13 | Báo giá `validBefore − serverDate = 300s`; sau 210 giây → "Lấy giá mới", không mở ví | Vitest (fake timers, header `Date`) |
| W2-E14 | 402 báo giá có `payTo` khác `fujiDeployment.address` → `quoteMismatch`, ví không mở | Vitest |
| W2-E15 (AP-07-AC03) | Poll đi qua `ANSWERING → CHECKING → SETTLING → PAID` → timeline đổi đúng bước; không có chữ "Đã thanh toán" / "Đã xác minh" ở trang Hỏi; bước 4 chỉ "xong" khi có `status` và `tx.settle` | Vitest |
| W2-E16 | 409 `QUESTION_ALREADY_SETTLED`, cả khi `details` có và khi không có → điều hướng tới `qid` đang giữ | Vitest |
| W2-E21 | Mở `/questions/<qid>` khi GET trả `stage: QUOTED` không có `status` → "Chưa giữ tiền. Bạn chưa bị trừ tiền." + link về Hỏi; không có chữ "Đã thanh toán" | Vitest |
| W2-E22 | Đang `signing`, đổi tài khoản trong ví, rồi ví trả chữ ký → không có POST lần 2, về `editing` | Vitest |
| W2-E17 | Chưa kết nối → nút "Kết nối ví để hỏi" mở đúng hộp thoại W1; sai mạng → "Chuyển sang Fuji" | Vitest |
| W2-E18 | Bàn phím: Tab tới textarea, Ctrl+Enter lấy giá, focus sang nút ký, Enter ký | Testing Library + thủ công |
| W2-E19 | **Thật trên Fuji bằng Core:** hỏi câu thử việc từ `localhost:3000` (qua rewrite) → ký → `/questions/<qid>` → tới `PAID`; câu ngoài phạm vi → `REFUNDED`. Ghi qid, tx deposit, tx settle | Thủ công. **Có broadcast** (deposit, settle do ví provider gửi): xin owner đồng ý trước, nêu mạng Fuji, ví người hỏi ký EIP-3009, ví provider gọi `deposit` và `settle`/`refundByProvider` trên `AskPayEscrow` |
| W2-E20 | Câu chậm hơn 30 giây (LLM giả chậm ở local) → không lỗi nhờ `proxyTimeout`; tắt `proxyTimeout` thì vào `unsure` rồi vẫn điều hướng đúng | Thủ công local |

W2-E19 là "Xong khi" của ticket.

## 13. Câu hỏi mở (owner chốt)

| Mã | Câu hỏi | Đề xuất |
|---|---|---|
| U-05 | **StepTimeline nằm ở đâu?** Ticket W2 có StepTimeline, ui-pages §4 đặt nó ở `/questions/[qid]` (W3), và §1.1 điều hướng sang đó khi đã giữ tiền. Route này chưa có, nên điều hướng ở W2 sẽ ra 404 | W2 làm `StepTimeline` + `useQuestionProgress` và **route tối thiểu** `/questions/[qid]`: câu hỏi, timeline, một dòng trạng thái chữ thường ("Đang xử lý", "Đã thanh toán", "Đã hoàn tiền" theo `status`). W3 thay dòng đó bằng `StatusBadge`, thêm `AnswerBody`, `CitationCard`, `TxLink`, cảnh báo hoàn tiền. Trang Hỏi cũng hiện timeline trong lúc chờ tiền vào (§6.2) |
| U-06 | **Lệch câu chữ (AP-03-AC07).** Spec: người hỏi thấy "hệ thống tạm không nhận câu hỏi". Shared `CHAIN_UNAVAILABLE`: "Chưa kết nối được blockchain. Bạn chưa bị trừ tiền, hãy thử lại sau." | Sửa câu trong `packages/shared/src/errors.ts` thành "Hệ thống tạm không nhận câu hỏi. Bạn chưa bị trừ tiền, hãy thử lại sau." (giữ ý "chưa bị trừ tiền"). Sửa ở slice W2 vì web là nơi đầu tiên hiện câu này. **Đổi cách làm 15/11/2026 theo owner, sau review:** `CHAIN_UNAVAILABLE` còn bị ném ở endpoint chỉ đọc (`history.service.ts`, `corpusInfo`), nơi câu "không nhận câu hỏi" sai ngữ cảnh. Giữ nguyên câu chung của shared ("Chưa kết nối được blockchain. …"); câu AP-03-AC07 nằm ở `askMessages.chainBusy` (`features/ask/messages.ts`) và chỉ luồng Hỏi dùng |
| U-07 | **"Thử lại" khi `PAYMENT_INVALID`** (ui-pages §3.1) nghĩa là gì? Câu shared bảo "Hãy hỏi lại để nhận báo giá mới" | Nghĩa là **lấy báo giá mới và ký lại**, không bao giờ gửi lại chữ ký cũ (chữ ký đã bị từ chối). Đổi nhãn nút trong ui-pages §3.1 thành "Lấy giá mới". "Gửi lại chữ ký cũ" chỉ dùng cho 503/429 và `unsure` (§6.1) |
| U-08 | Biên an toàn hạn báo giá: 90 giây trước `validBefore` (§6.5) | Đồng ý 90 giây. Với `QUOTE_TTL_SECONDS = 300`, người dùng còn 3 phút 30 giây để đọc giá và ký |
| U-09 | Điều hướng khi nào? ui-pages §1.1: "thành công tới bước giữ tiền". Mã A5 cho thấy `DEPOSITING` vẫn có thể lùi về `QUOTED` | Điều hướng khi `stage ≥ ANSWERING`, hoặc khi POST trả 200/202/409-settled (§6.2). Sửa câu ở ui-pages §1.1 cho khớp |
| U-10 | **RPC Fuji mặc định** (ngoài thiết kế gốc, phát sinh lúc chạy E19). `api.avax-test.network` rate limit theo IP (Cloudflare 1015); API nhận kết quả `settle` chậm khoảng 1 phút dù chain đã xong sau 7 giây | **Owner chốt 15/11/2026:** đổi mặc định sang `https://avalanche-fuji-c-chain-rpc.publicnode.com` ở `apps/web/src/lib/constants.ts`, `apps/api/.env.example` và runbook. Đánh đổi đã nêu: địa chỉ ví người dùng đi tới bên thứ ba khi đọc số dư; lợi ích tốc độ **chưa đo lại** (owner báo hoạt động tốt hơn, chưa có số); đổi mặc định RPC của API. Ghi đè bằng `NEXT_PUBLIC_RPC_URL` (web) và `RPC_URL` (API) |

## 14. Ngoài phạm vi W2

Lưu câu hỏi nháp qua lần tải lại, lịch sử câu đã hỏi của ví, hiển thị câu trả lời và trích dẫn (W3), huỷ một câu đã ký, nhiều câu song song, tỉ giá VND sống, WalletConnect.

## 15. Kết quả chạy thật (W2-E19, 15/11/2026)

Owner chạy trên Fuji bằng Core, qua `localhost:3000` và rewrite. Tách bằng chứng đã đối chiếu với lời báo:

| Nhánh | Kết quả | Mức bằng chứng |
|---|---|---|
| Câu trong phạm vi → `PAID` | Đạt. qid `0xdb76d194d0b0acef478d5f41f83c89b6fc2ecc6977f81147b8a5f96bd4c1d787`, deposit `0xda4c27771b4d0bb7dbd02cd861da8efbc5dc5a12a6f92a7ea24a7baa6500baf5` (block 61108925), settle `0xf64dba75ae0fcc757c8eefdd8e1aea57cd014fb2a56f16b2faf5ba9588583323` (block 61108933) | Đã đọc receipt trên Fuji: cả hai tx `status 1`, `from` ví provider, `to` escrow. Chưa tự giải mã input của tx và chưa đọc trạng thái câu hỏi trên escrow. Chữ "Đã thanh toán" trên `/questions/<qid>`: theo lời owner |
| Câu ngoài phạm vi → `REFUNDED` | Đạt theo lời owner | **Chưa có qid hay tx để đối chiếu** |

Quan sát đáng ghi: tx settle mined sau deposit 7 giây nhưng API chỉ ghi nhận sau khoảng 62–68 giây (`settle outcome unknown`, rồi `Paid`). Nghi do RPC (xem U-10), chưa xác nhận. Theo lời owner (15/11/2026): E19 coi như thành công (cả hai nhánh); E18 đã tự test xong. Chưa kiểm và để sau:
- **E20 trên trình duyệt thật:** đã chạy một API giả trả lời sau 35 giây qua rewrite của `next start` (HTTP 200 sau 35 giây). Chưa chạy nhánh đối chứng (tắt `proxyTimeout`), chưa chạy với `next dev`. Gợi ý câu để thử (đoán, chưa đo, vì độ chậm phụ thuộc LLM): câu gần 500 ký tự gồm nhiều ý ở nhiều điều khác nhau của Bộ luật Lao động, ví dụ thử việc, thôi việc, làm thêm giờ và nghỉ thai sản trong cùng một câu, để câu trả lời dài và cần nhiều trích dẫn. Cách chắc chắn hơn là dùng LLM giả có độ trễ cấu hình được ở local.
- **Mục Vercel/proxy ở §9** (O1, 19/11).
