# W3 — Trang kết quả `/questions/[qid]`

> **Trạng thái:** đã duyệt (15/11/2026): owner chốt U-11..U-15 theo đề xuất và đồng ý sửa các chỗ lệch ở §12. Ticket W3 ([tasks.csv](../runbook/tasks.csv)), hạn 16/11. Phụ thuộc W2 (PR #18, đã merge).
> Nguồn: [ui-pages §4](../product/ui-pages.md#4-questionsqid--kết-quả), [design-system §3, §4](../product/design-system.md), [frontend convention](../conventions/frontend.md), [api.md §3.2, §4](../architecture/api.md), [contracts.md §4](../architecture/contracts.md), [W1 U-01](./w1-web-shell.md#10-câu-hỏi-mở-owner-chốt), [W2 §8](./w2-ask.md), spec AP-07, Q-04, Q-05, Q-10, Q-13.
> Tài liệu này không đổi hành vi trong spec và không đổi API. Ba chỗ lệch giữa các tài liệu nằm ở §12 (đã sửa theo đề xuất).

## 1. Người dùng và việc cần làm

- **Ai:**
  - Người hỏi vừa được W2 chuyển sang đây.
  - Người mở link chia sẻ, kể cả giám khảo xem trên điện thoại. Người này có thể không có ví.
- **Việc ở W3:** đọc câu trả lời và căn cứ. Thấy tiền đã trả hay đã hoàn, vì sao. Mở được tx trên Snowtrace. Thấy dấu xác minh hai dòng khi và chỉ khi được phép (AP-07-AC02).
- **Xong khi** (ticket): trang có đủ các trạng thái ở ui-pages §4.2.
- **W3 thay dòng trạng thái chữ thường của W2 (§8.1) bằng:**
  - `StatusBadge`
  - `AnswerBody`
  - `CitationCard`
  - `TxLink`
  - `RefundNotice`
- **Không thuộc W3:**
  - Nút "Nhận lại tiền" và đọc thẳng `questions(qid)` từ contract khi API sập (W5).
  - Bước kiểm `citationsHash` trên giao diện (Q-13: v1 không có).
  - Dashboard (W4).
- **Không cần ví.** Trang chỉ đọc API. Chưa kết nối ví hay ví ở sai mạng không làm đổi nội dung trang.

## 2. Bố cục

```
┌──────────────────────────────────────────────────────┐
│ Câu hỏi                                               │  nhãn nhỏ
│ Thử việc tối đa bao lâu nếu cần bằng cao đẳng?        │  h1 (sans 24px)
│ [✓ ĐÃ THANH TOÁN]  0,05 USDC · 15/11 21:40            │  StatusBadge + ResultMeta
│ Giữ tiền 0xda4c…baf5 ↗ · Thanh toán 0xf64d…3323 ↗     │  TxLink ×2
├──────────────────────────────────────────────────────┤
│ ✓ Giữ tiền  ✓ Trả lời  ✓ Kiểm tra  ✓ Chốt             │  StepTimeline (W2)
├──────────────────────────────────────────────────────┤
│ (RefundNotice nếu bị hoàn tiền)                        │
│ Câu trả lời                                            │  h2
│ Theo Khoản 2 Điều 25, thời gian thử việc …            │  AnswerBody
│ ⓘ Thông tin tham khảo, không thay thế tư vấn pháp lý. │  lặp disclaimer (W1 U-01)
├──────────────────────────────────────────────────────┤
│ Căn cứ                                                 │  h2
│ ┃ Điều 25 · Khoản 2 — Thời gian thử việc              │  CitationCard ×n
│ ┃ “không quá 60 ngày đối với công việc …”             │
│ ┃ ✓ Khoản có trong luật đã đăng ký on-chain           │
│ ┃   Đoạn trích và mức liên quan: checker đã ký        │
│ ┃                                  Xem nguyên văn ▾   │
├──────────────────────────────────────────────────────┤
│ [Hỏi câu khác]                                         │
└──────────────────────────────────────────────────────┘
```

- **Thứ tự DOM** (cũng là thứ tự đọc):
  1. h1 câu hỏi
  2. dòng tiền (badge, số tiền, giờ, tx)
  3. timeline
  4. cảnh báo
  5. câu trả lời
  6. disclaimer
  7. căn cứ
  8. nút cuối trang
- **Khi đã chốt,** timeline vẫn hiện nhưng không còn `aria-live`, để trình đọc màn hình không đọc lại khi trang tải.

### 2.1 Cây file

| File | Vai trò |
|---|---|
| `app/questions/[qid]/page.tsx` | Giữ nguyên (mỏng) |
| `features/ask/components/QuestionProgressView.tsx` | **Mở rộng** từ W2 thành `ResultView`: ghép các phần bên dưới theo `view` (§3). Giữ tên file, hoặc đổi tên thành `ResultView.tsx` trong cùng PR. Tách thành nhiều file nếu vượt khoảng 200 dòng |
| `features/ask/result-view.ts` | **Hàm thuần** `toResultView({ result, notFound, loadFailed })` (không cần `now`): QuestionResult → mô tả màn hình (§3). Test đơn vị toàn bộ bảng trạng thái |
| `features/ask/quote-match.ts` | Hàm thuần `locateQuote(text, quote)` (§6.2) |
| `features/ask/components/StatusBadge.tsx`, `ResultMeta.tsx`, `AnswerBody.tsx`, `CitationCard.tsx`, `CitationList.tsx`, `RefundNotice.tsx` | Biết nghiệp vụ, nên đặt trong feature |
| `components/ui/Badge.tsx`, `Card.tsx`, `TxLink.tsx` | Dùng chung, không biết nghiệp vụ (design-system §3). W4 dùng lại `Badge` và `TxLink` |
| `components/layout/DisclaimerBanner.tsx` | Thêm biến thể `inline` cho chỗ lặp dưới câu trả lời. Câu chữ vẫn lấy từ `messages.disclaimer` |
| `lib/format.ts` | Thêm `shortHash`, `snowtraceTxUrl`, `formatDateTimeVi` |
| `features/ask/hooks.ts` | Sửa `useQuestionProgress` theo §7 |
| `features/ask/messages.ts` | Chuỗi ở §10 |

## 3. Mô hình màn hình (`toResultView`)

```ts
type ResultView =
  | { kind: 'loading' }
  | { kind: 'notFound' }
  | { kind: 'loadFailed' }                                   // chưa có dữ liệu lần nào
  | { kind: 'notHeld'; question: string }                    // QUOTED / EXPIRED (W2 §8.1)
  | { kind: 'question';
      question: string;
      badge: 'pending' | 'paid' | 'refunded' | 'expired';
      meta: { amount?: bigint; createdAt?: number; deposit?: Hex; settle?: Hex; settleKind: 'paid' | 'refund' };
      timeline: StepsInput | undefined;                      // undefined ở CLAIMABLE
      notice?: { kind: RefundNoticeKind; reason?: RefundReasonCode } | { kind: 'claimable' };
      answer?: { text: string; tone: 'normal' | 'muted' } | { skeleton: true };
      citations: CitationView[];
      verifying: boolean;                                    // PAID nhưng chưa đối chiếu được (§5.3)
      actions: ('askAnother' | 'askAgain')[] };
```

**Quy tắc "đã chốt", dùng chung một chỗ.** Một câu được coi là đã chốt khi `status ∈ {PAID, REFUNDED}` **và** có `tx.settle`.

- `StatusBadge`, bước 4 của `StepTimeline` (đã làm ở `steps.ts` W2) và điều kiện dừng poll (§7) cùng gọi hàm `isSettled(result)` đặt trong `result-view.ts`.
- `status` đã chốt mà chưa có `tx.settle` thì vẫn hiện "ĐANG XỬ LÝ" và **poll tiếp, nhưng có giới hạn** (§7): tối đa 30 lần đọc thêm, cách 1 giây. Hết hạn mức thì dừng, hiện dòng "Chưa nhận được xác nhận chốt từ blockchain." và nút "Thử lại" (đặt lại hạn mức). Trang không vừa hiện "Đang xử lý" vừa im lặng ngừng poll mà không nói gì.
- Theo mã A5/A6, server chỉ ghi `PAID`/`REFUNDED` sau khi có receipt, nên trường hợp này gần như không xảy ra. Quy tắc trên là lưới an toàn cho AP-07-AC03.

## 4. Bảng trạng thái

| Dữ liệu từ API | Badge | Thông báo | Câu trả lời | Thẻ căn cứ | Hành động |
|---|---|---|---|---|---|
| Đang tải lần đầu | — | — | Skeleton | — | — |
| `404` | — | "Không tìm thấy câu hỏi này." | — | — | "Về trang Hỏi" |
| Lỗi tải, chưa có dữ liệu | — | "Không tải được kết quả." | — | — | "Thử lại" (khác 404) |
| Lỗi tải, **đã có** dữ liệu, còn lần đọc kế | Giữ nguyên | Dòng nhỏ `ink-muted`: "Mất kết nối, đang thử lại…" | Giữ nguyên | Giữ nguyên | — |
| Lỗi tải, **đã có** dữ liệu, trang đã ngừng poll | Giữ nguyên | "Mất kết nối. Thông tin trên trang có thể đã cũ." (không nói "đang thử lại") | Giữ nguyên | Giữ nguyên | "Thử lại" |
| `QUOTED`/`EXPIRED`, không có `status` | — | "Chưa giữ tiền. Bạn chưa bị trừ tiền." (W2) | — | — | "Về trang Hỏi" |
| `PENDING` · `DEPOSITING` | ĐANG XỬ LÝ | — | Skeleton | — | — |
| `PENDING` · `ANSWERING`/`CHECKING`/`SETTLING` | ĐANG XỬ LÝ | — | Skeleton. **Không** hiện `answer` dù API đã có: chưa chốt thì chưa được coi là câu trả lời | — | — |
| `PAID` (đã chốt) | ĐÃ THANH TOÁN | — | `normal` | Thẻ theo §5; ✓ hai dòng khi `verifiedOnChain` | "Hỏi câu khác" |
| `REFUNDED` · `NO_CITATION` | ĐÃ HOÀN TIỀN | Tiêu đề "Không tìm thấy căn cứ trong Bộ luật Lao động 2019" + `REFUND_REASONS.NO_CITATION` | Có `answer` thì hiện `muted`. Thêm cảnh báo Q-04 nếu `noBasis = false` (§4.1) | Không có thẻ | "Hỏi câu khác" |
| `REFUNDED` · `INVALID_CITATION` / `CHECKER_REJECTED` | ĐÃ HOÀN TIỀN | Khung cảnh báo: "Câu trả lời dưới đây **không đạt kiểm tra**, đừng dựa vào nó." + câu lý do | `muted` | Thẻ viền `refund`, **không** ✓ | "Hỏi câu khác" |
| `REFUNDED` · `ANSWER_FAILED` | ĐÃ HOÀN TIỀN | "Hệ thống không trả lời được lúc này, bạn đã được hoàn tiền." | — (`answer` là `null`) | — | "Hỏi lại" (U-14) |
| `REFUNDED` · `TIMEOUT` | ĐÃ HOÀN TIỀN | "Tiền đã được trả lại vào ví của bạn." | Có thì `muted` + cảnh báo Q-04 dạng "chưa qua kiểm tra" (checker chưa chạy) | Có thì viền `refund`, không ✓ | "Hỏi câu khác" |
| `CLAIMABLE` | QUÁ HẠN | "Đã quá 10 phút mà chưa có kết quả." | — | — | Không có ở W3 (nút ở W5) |
| `status` đã chốt, chưa có `tx.settle` | ĐANG XỬ LÝ | — | Skeleton | — | "Thử lại" khi đã hết hạn mức poll (§3, §7) |

- **Câu lý do** lấy từ `REFUND_REASONS[reason]` của shared.
- **Câu tiêu đề** lấy từ ui-pages §4.2, gom trong `messages.ts`.
- **`reason` thiếu** (`null` hoặc không có): hiện chung "Đã hoàn tiền vào ví của bạn." Không đoán lý do.

### 4.1 Hiện câu trả lời khi bị hoàn tiền (Q-04)

- Q-04 đã chốt: hiện kèm cảnh báo.
- **"Mờ đi" nghĩa là chữ `ink-muted`** (6,44:1 trên `paper`), không dùng `opacity`. `opacity` làm tụt tương phản dưới AA.
- Khung cảnh báo đứng **trước** câu trả lời trong DOM. Câu trả lời có `aria-describedby` trỏ tới khung, để trình đọc màn hình nghe cảnh báo trước nội dung.
- **`NO_CITATION` với `noBasis = true`:** câu trả lời thường chỉ nói "không có căn cứ". Hiện `muted`, không thêm cảnh báo "đừng dựa vào nó", vì không có gì để dựa vào.
- **`NO_CITATION` với `noBasis = false`:** LLM có trả lời nhưng không trích. Thêm cảnh báo Q-04.

## 5. `CitationCard`

### 5.1 Nội dung

- Thẻ hiện theo **đúng thứ tự `citations[]`**. Đây là thứ tự đã băm vào `citationsHash`. Không sắp xếp lại.
- **Dòng tiêu đề:** `Điều {dieu} · Khoản {khoan} — {dieuTitle}`, sans đậm. `khoan = 0` (Điều không chia khoản) thì bỏ phần "· Khoản …".
- **Đoạn trích:** `“{quote}”`, serif nghiêng, line-height 1,75. Đây là một trong hai nơi được dùng serif (design-system §2.2).
- **Viền trái 3px:** `seal` khi `PAID`, `refund` khi `REFUNDED` (design-system §4.3).
- **"Xem nguyên văn":**
  - Dùng `<details>`/`<summary>` gốc của trình duyệt: có sẵn bàn phím và `aria-expanded`.
  - Bên trong là `text` (serif, giữ xuống dòng bằng `white-space: pre-line`), có `<mark>` tô đoạn trích (§6).
  - `text` rỗng (`''` vì `?? ''` ở `ask.result.ts`) thì không hiện `<details>`. Thay bằng dòng `ink-muted` "Chưa tải được nguyên văn Khoản này."
- **Hiển thị nội dung:** `answer`, `quote`, `text` và `dieuTitle` render như văn bản thuần (React text node). Không HTML, không markdown, không `dangerouslySetInnerHTML`. `answer` giữ xuống dòng bằng `pre-line`.

### 5.2 Dấu xác minh hai dòng (AP-07-AC02, Q-10)

- **Điều kiện hiện:** `status === 'PAID' && isSettled && citation.verifiedOnChain === true`. Không có điều kiện nào khác.
- **Một component duy nhất `VerifiedMark`** render **cả hai dòng**. Không có prop nào để render riêng dòng chính.
  - **Dòng chính:** icon `badge-check` màu `paid` + "Khoản có trong luật đã đăng ký on-chain". Chữ `paid` trên `surface` đạt 6,15:1.
  - **Dòng phụ:** "Đoạn trích và mức liên quan: checker đã ký", 14px `ink-muted`.
- **Chữ cấm** ở trang này (design-system §6, spec §8):
  - "Đã xác minh on-chain"
  - "Blockchain kiểm đúng nguyên văn"
  - Không chuỗi nào trong `messages.ts` chứa các cụm này (có test).
- **Thẻ của câu bị hoàn tiền:** không ✓, và **không kết luận gì về từng thẻ**. API không nói thẻ nào hỏng:
  - `CHECKER_REJECTED` gộp cả C2, C3 và C4.
  - `INVALID_CITATION` là Merkle proof không khớp.

  Lý do chỉ nói ở mức câu hỏi (RefundNotice).

### 5.3 `PAID` nhưng `verifiedOnChain = false`

- **Nguyên nhân có thể có** (api.md §3.2):
  - RPC lỗi lúc đọc receipt (tạm thời).
  - Dữ liệu server bị sửa (lâu dài).
  - Web không phân biệt được hai trường hợp.
- **Hiển thị:**
  - Badge vẫn là ĐÃ THANH TOÁN, vì tiền đã chốt theo event.
  - Thẻ **không** có ✓.
  - Một dòng chung trên danh sách căn cứ, màu `ink-muted`, icon `info`: "Chưa đối chiếu được trích dẫn với blockchain." Không màu `error`, không lời buộc tội.
  - Trong lúc đang thử lại (§7), thêm "Đang thử lại…".
- **Không bao giờ** hiện ✓ cho thẻ này dựa trên dữ liệu cũ hay đoán.

## 6. Tô đoạn trích trong nguyên văn

### 6.1 Vì sao không dùng `indexOf`

- `quote` đã qua `normalizeText`: NFC, gộp mọi dãy khoảng trắng thành một dấu cách, cắt hai đầu.
- `text` là nguyên văn, còn xuống dòng giữa các điểm a), b), c).
- `text.indexOf(quote)` sẽ trượt mỗi khi đoạn trích vắt qua một chỗ xuống dòng.

### 6.2 `locateQuote(text, quote): { start, end } | undefined`

- Làm việc trên `text.normalize('NFC')`. Nguyên văn hiển thị cũng là chuỗi NFC này, nên vị trí tìm được khớp với chuỗi đang hiện.
- Chuyển `quote` thành mẫu: thoát ký tự đặc biệt của regex, thay mỗi dấu cách bằng `\s+`, cờ `u`. Tìm lần xuất hiện **đầu tiên**.
- Hàm phải khớp được mọi đoạn trích mà checker C2 đã chấp nhận: `normalizeText(text).includes(quote)` đúng thì `locateQuote` phải tìm thấy (test tính chất trên corpus thật, §11).
- Web không import `@askpay/corpus`. Quy tắc trên tương đương `normalizeText` ở phía so khớp, và được khoá lại bằng test.
- **Không tìm thấy:** hiện nguyên văn không tô, không kèm câu nào.
  - Với `PAID` thì không nên xảy ra (C2 đã qua). Nếu xảy ra thì ghi `console.warn` ở dev.
  - Với `REFUNDED` thì im lặng, theo §5.2.
- **`<mark>`:** nền `seal` pha 12% (`#EBDDD7`), chữ `ink` (12,99:1). Có `aria-label` "đoạn được trích" qua một `<span class="sr-only">` đặt trước nó.

## 7. Poll và làm mới (`useQuestionProgress`)

W2 dừng poll khi `status ∈ {PAID, REFUNDED, CLAIMABLE}` hoặc `stage = EXPIRED`. W3 đổi ba điểm:

| Tình huống | W2 | W3 |
|---|---|---|
| `PAID`/`REFUNDED` nhưng chưa có `tx.settle` | Dừng | **Poll 1 giây, tối đa 30 lần đọc thêm** (khoảng 30 giây), rồi dừng. Nút "Thử lại" và nút của dòng "Mất kết nối" đều đặt lại hạn mức |
| `PAID`, đã chốt, có thẻ `verifiedOnChain = false` | Dừng | Thử lại có giới hạn: sau 3, 6, 12, 24 giây (4 lần). Có `true` thì dừng. Hết 4 lần thì dừng và giữ dòng §5.3 |
| `CLAIMABLE` | Dừng | **Poll chậm 10 giây.** `settle` vẫn chạy được sau `deadline` nếu chưa ai `claimRefund` (contracts.md §4), nên `CLAIMABLE` có thể thành `PAID` hoặc `REFUNDED`. W5 gọi `refetch()` ngay sau tx `claimRefund` |
| Các trường hợp khác | Như W2 | Như W2 |

- Poll ở tab nền giữ như W2 (`refetchIntervalInBackground`).
- Riêng `CLAIMABLE` thì **tắt** poll ở tab nền, để giảm tải giới hạn 120 lần đọc mỗi phút. Một timer 10 giây đã đặt trước khi tab bị ẩn vẫn bắn đúng một lần, rồi mới dừng (chấp nhận).
- `useQuestionProgress` trả thêm `verifyRetrying` (đang trong các lần thử lại §5.3) cho dòng "Đang thử lại…".
- **Ngưỡng tải:** một tab ở `PENDING` dùng 60 lần mỗi phút, đúng như W2. Các nhánh mới chỉ thêm tối đa 6 lần mỗi phút.
- Lỗi khi **đã có** dữ liệu: giữ dữ liệu cũ trên màn hình.
  - Còn lần đọc kế (theo bảng trên) thì poll tiếp và hiện "Mất kết nối, đang thử lại…".
  - Không còn lần đọc nào (trang đã chốt và đối chiếu xong, hết hạn mức, hay hết 4 lần thử lại §5.3) thì **không** nói "đang thử lại": hiện "Mất kết nối. Thông tin trên trang có thể đã cũ." kèm nút "Thử lại".
  - Tab nền ở `CLAIMABLE` vẫn tính là còn lần đọc kế (focus refetch sẽ đọc lại).
- **`aria-live`:** chỉ một vùng `polite` báo **đổi badge** (ví dụ "Đã thanh toán"). Không đọc mỗi lần poll. Vùng đọc bước của timeline (W2) tắt khi đã chốt.

## 8. `StatusBadge`, `ResultMeta`, `TxLink`

### 8.1 Badge

| Badge | Nhãn | Icon (lucide) | Tông |
|---|---|---|---|
| `pending` | ĐANG XỬ LÝ | `loader-circle` (xoay; dừng khi `prefers-reduced-motion`) | `pending` |
| `paid` | ĐÃ THANH TOÁN | `badge-check` | `paid` |
| `refunded` | ĐÃ HOÀN TIỀN | `rotate-ccw` | `refund` |
| `expired` | QUÁ HẠN | `clock-alert` | `expired` |

- Nhãn viết hoa, đậm 12px, có khoảng cách chữ, bo tròn hẳn (design-system §4.1). Icon luôn có kèm chữ.
- **Tương phản, đã tính 15/11/2026.** Nền là tông pha 12% trên `paper`. Chữ 12px cần ≥ 4,5:1.

  | Tông | Chữ cùng tông trên nền nhạt | Chữ `ink` trên nền nhạt |
  |---|---|---|
  | `paid` | 4,87 | 13,62 |
  | `pending` | 6,44 | 13,34 |
  | `refund` | **4,07 (không đạt)**. Đã có quy tắc dùng `ink` (W1 U-03) | 13,76 |
  | `expired` | **4,28 (không đạt)** | 13,82 |

  `expired` là chỗ hỏng mới. **Đã chốt (U-11):** cả bốn badge dùng chữ `ink`, icon và nền nhạt mang tông màu (icon chỉ cần ≥ 3:1, cả bốn đạt).

### 8.2 `ResultMeta`

- Thứ tự trên một hàng: badge · `0,05 USDC` (`formatUsdcVi(amount)`) · giờ tạo.
- **Giờ tạo:** `formatDateTimeVi(createdAt)` cho ra `15/11 21:40`, cố định múi `Asia/Ho_Chi_Minh` bằng `Intl.DateTimeFormat`. Phần `title` có ngày đầy đủ.
- **Thiếu dữ liệu:**
  - Không có `amount` (câu chưa giữ tiền) thì bỏ phần số tiền.
  - Không có `createdAt` thì bỏ phần giờ.
- **Hàng thứ hai, các `TxLink`:**
  - "Giữ tiền" → `tx.deposit`.
  - "Thanh toán" (khi `PAID`) hoặc "Hoàn tiền" (khi `REFUNDED`) → `tx.settle`.
  - Với `TIMEOUT`, `tx.settle` là tx `claimRefund` (api.md §4), vẫn gọi là "Hoàn tiền".
  - Thiếu hash nào thì bỏ link đó, không hiện link rỗng.

### 8.3 `TxLink` (`components/ui`)

- Props: `{ hash: Hex; label?: string }`.
- Hiển thị: `shortHash(hash)`, ví dụ `0xda4c…baf5`, font mono, icon `external-link`, tới `testnet.snowtrace.io/tx/<hash>`.
- `target="_blank" rel="noopener noreferrer"`, `title` là hash đầy đủ, có chữ sr-only "(mở tab mới)" (`messages.opensInNewTab`). Giống `Address` của W1.
- Tên dễ đọc của link: `"{label}: {hash rút gọn} (mở tab mới)"`.

## 9. Tương tác, responsive, a11y

- **h1** là câu hỏi, không phải tiêu đề chung. Đặt `document.title` thành `"{câu hỏi} · AskPay"` khi có dữ liệu: gộp mọi khoảng trắng và xuống dòng thành một dấu cách, cắt ở 60 **ký tự** (không cắt đôi một ký tự), thêm "…" nếu bị cắt. Rời trang thì trả lại title cũ.
- **Disclaimer lặp ngay dưới `AnswerBody`** (cam kết W1 U-01, đã duyệt):
  - Dùng cùng câu `messages.disclaimer`, icon `info`, chữ `ink-muted` 14px.
  - Hiện ở **mọi** trạng thái có khung câu trả lời, kể cả skeleton.
  - Không thay cho banner ở chân trang. Không dùng landmark `aside` lần hai, để trình đọc màn hình không thấy hai landmark trùng tên.
- **Nút cuối trang:**
  - "Hỏi câu khác" (link tới `/`, kiểu `secondary`).
  - Hoặc "Hỏi lại" (U-14).
- **360px:**
  - Dòng tiền xuống hai hàng.
  - Hash rút gọn không bị cắt.
  - Thẻ căn cứ rộng hết màn hình.
  - Nguyên văn dài cuộn theo trang, không cuộn riêng trong thẻ.
- **Bàn phím:** Tab đi qua các link tx → "Xem nguyên văn" từng thẻ (Enter/Space mở) → nút cuối trang. Focus luôn thấy được.
- **Lighthouse a11y ≥ 90** trên trang Kết quả (design-system §8).

## 10. Chuỗi giao diện (`features/ask/messages.ts`)

```
// giữ từ W2: yourQuestion, notHeldPage, notFound, loadFailed, loading, retry, backToAsk
badge: { pending: 'ĐANG XỬ LÝ', paid: 'ĐÃ THANH TOÁN', refunded: 'ĐÃ HOÀN TIỀN', expired: 'QUÁ HẠN' }
badgeAnnounce: { paid: 'Đã thanh toán', refunded: 'Đã hoàn tiền', expired: 'Quá hạn' }
answerHeading: 'Câu trả lời'          citationsHeading: 'Căn cứ'
txDeposit: 'Giữ tiền'  txPaid: 'Thanh toán'  txRefund: 'Hoàn tiền'
khoanTitle: (dieu, khoan, title) => khoan > 0 ? `Điều ${dieu} · Khoản ${khoan} — ${title}` : `Điều ${dieu} — ${title}`
verifiedMain: 'Khoản có trong luật đã đăng ký on-chain'
verifiedSub: 'Đoạn trích và mức liên quan: checker đã ký'
showFullText: 'Xem nguyên văn'   quotedPart: 'đoạn được trích'
fullTextMissing: 'Chưa tải được nguyên văn Khoản này.'
notVerified: 'Chưa đối chiếu được trích dẫn với blockchain.'   retrying: 'Đang thử lại…'
noBasisTitle: 'Không tìm thấy căn cứ trong Bộ luật Lao động 2019'
failedCheckWarning: 'Câu trả lời dưới đây không đạt kiểm tra, đừng dựa vào nó.'
uncheckedWarning: 'Câu trả lời dưới đây chưa qua kiểm tra, đừng dựa vào nó.'   // TIMEOUT có answer
answerFailed: 'Hệ thống không trả lời được lúc này, bạn đã được hoàn tiền.'
timeoutRefunded: 'Tiền đã được trả lại vào ví của bạn.'
refundedGeneric: 'Đã hoàn tiền vào ví của bạn.'
claimable: 'Đã quá 10 phút mà chưa có kết quả.'   // giữ statusClaimable của W2
reconnecting: 'Mất kết nối, đang thử lại…'
connectionLost: 'Mất kết nối. Thông tin trên trang có thể đã cũ.'   settleStalled: 'Chưa nhận được xác nhận chốt từ blockchain.'
askAnother: 'Hỏi câu khác'   askAgain: 'Hỏi lại'
```

- Câu lý do hoàn tiền lấy từ `REFUND_REASONS` của shared. Câu lỗi lấy từ `ERROR_CODES`.
- Các chuỗi `statusPending`/`statusPaid`/`statusRefunded` của W2 bị bỏ, vì badge thay chúng.

## 11. Ví dụ chấp nhận

Test dùng `QuestionResult` giả (fixture theo `questionResultSchema`) đưa qua `fetch` giả. Hàm thuần (`toResultView`, `locateQuote`, `isSettled`) có test đơn vị riêng.

| Mã | Cho / Khi / Thì | Kiểm bằng |
|---|---|---|
| W3-E01 (AP-07-AC01) | `PAID`, đủ trường → thấy h1 câu hỏi, badge ĐÃ THANH TOÁN, `0,05 USDC`, giờ `dd/MM HH:mm` theo giờ Việt Nam, hai link Snowtrace đúng `…/tx/<hash>`, mở tab mới | Vitest |
| W3-E02 (AP-07-AC02) | `PAID` + `verifiedOnChain = true` → mỗi thẻ có **cả hai** dòng của dấu. Test quét DOM: không có dòng chính nào thiếu dòng phụ | Vitest |
| W3-E03 (AP-07-AC02, Q-13) | `PAID` + `verifiedOnChain = false` → không ✓, có "Chưa đối chiếu được trích dẫn với blockchain." (không màu `error`), refetch sau 3/6/12/24 giây. Lần 2 trả `true` → ✓ hiện, dừng poll | Vitest (fake timers) |
| W3-E04 (AP-07-AC03) | `status: PAID` mà không có `tx.settle` → badge ĐANG XỬ LÝ, không ✓, **vẫn poll**. Lần sau có `tx.settle` → ĐÃ THANH TOÁN | Vitest |
| W3-E05 (AP-07-AC03) | `PENDING` · `ANSWERING` có sẵn `answer` trong dữ liệu → câu trả lời **không** hiện (skeleton), không có chữ "Đã thanh toán"/"Đã hoàn tiền" | Vitest |
| W3-E06 (Q-04) | `REFUNDED` · `CHECKER_REJECTED` → badge ĐÃ HOÀN TIỀN (không đỏ), khung cảnh báo đứng trước câu trả lời, câu trả lời chữ `ink-muted` (không `opacity`), thẻ viền `refund` không ✓, câu lý do đúng `REFUND_REASONS.CHECKER_REJECTED`; không thẻ nào có câu kết luận riêng | Vitest |
| W3-E07 | `REFUNDED` · `INVALID_CITATION` → như E06, câu lý do của `INVALID_CITATION` | Vitest |
| W3-E08 | `REFUNDED` · `NO_CITATION`: có `noBasis = true` thì không có cảnh báo Q-04; có `noBasis = false` thì có; cả hai có tiêu đề "Không tìm thấy căn cứ…" và không có thẻ | Vitest |
| W3-E09 | `REFUNDED` · `ANSWER_FAILED`, `answer = null` → câu "Hệ thống không trả lời được…", nút "Hỏi lại" | Vitest |
| W3-E10 | `REFUNDED` · `TIMEOUT` → "Tiền đã được trả lại vào ví của bạn.", link "Hoàn tiền" trỏ `tx.settle` | Vitest |
| W3-E11 | `CLAIMABLE` → badge QUÁ HẠN, câu quá hạn, không có nút; poll 10 giây; lần sau trả `PAID` → trang đổi | Vitest (fake timers) |
| W3-E12 | `404` → "Không tìm thấy câu hỏi này."; lỗi 500 lần đầu → "Không tải được kết quả." + "Thử lại"; lỗi 500 khi đã có dữ liệu → dữ liệu cũ vẫn hiện + "Mất kết nối, đang thử lại…" | Vitest |
| W3-E13 | `locateQuote`: đoạn trích vắt qua chỗ xuống dòng giữa điểm a) và b) → tìm đúng vị trí trong nguyên văn; chuỗi NFD → vẫn tìm thấy; ký tự regex (`(`, `.`) trong đoạn trích → không lỗi; không có → `undefined` | Vitest (đơn vị) |
| W3-E14 | **Tính chất trên corpus thật:** với mỗi Khoản trong `packages/corpus` và nhiều đoạn con (cắt ngẫu nhiên có seed cố định, ≥ 15 ký tự, đã `normalizeText`) → `locateQuote` luôn tìm thấy | Vitest (test chỉ chạy được ở repo, được import corpus) |
| W3-E15 | "Xem nguyên văn" mở bằng Enter → thấy nguyên văn serif, đoạn trích nằm trong `<mark>`; `text = ''` → không có `<details>`, có "Chưa tải được nguyên văn Khoản này." | Vitest |
| W3-E16 | Câu trả lời chứa `<b>x</b>` và `**y**` → hiện đúng nguyên chữ, không thành thẻ HTML hay chữ đậm | Vitest |
| W3-E17 (AP-07-AC04, W1 U-01) | Mọi trạng thái có khung câu trả lời (skeleton, PAID, REFUNDED) → câu disclaimer nằm ngay sau câu trả lời; banner chân trang vẫn còn; chỉ có một landmark "Lưu ý pháp lý" | Vitest |
| W3-E18 | Không có chuỗi nào trong `messages.ts` chứa "Đã xác minh" hoặc "kiểm đúng nguyên văn" | Vitest |
| W3-E19 | Thẻ hiện đúng thứ tự `citations[]` của API (fixture cố ý không theo thứ tự Điều) | Vitest |
| W3-E20 | Chưa kết nối ví, rồi sai mạng → nội dung trang không đổi | Vitest |
| W3-E21 | **Thật, chỉ đọc, không broadcast:** mở `localhost:3000/questions/0xdb76d194d0b0acef478d5f41f83c89b6fc2ecc6977f81147b8a5f96bd4c1d787` (câu `PAID` của W2-E19) → badge, hai tx khớp hash ở w2-ask §15, ✓ hai dòng; mở link Snowtrace thấy đúng tx. Lấy một câu `REFUNDED` từ `GET /api/questions` → badge hổ phách, câu lý do | Thủ công |
| W3-E22 | Bàn phím + 360px + Lighthouse a11y ≥ 90 trên trang ở E21 | Thủ công |

- `INVALID_CITATION` (chế độ demo gian lận) và `CHECKER_REJECTED` thật cần broadcast. Ở W3 chỉ kiểm bằng fixture.
- Muốn chạy thật thì xin owner trước, nêu rõ:
  - mạng: Fuji
  - ví người hỏi: ký EIP-3009
  - ví provider: gọi `deposit` rồi `settle` trên `AskPayEscrow`

## 12. Lệch giữa các tài liệu (đã sửa theo đề xuất, 15/11/2026)

| # | Chỗ lệch | Đề xuất |
|---|---|---|
| L-1 | frontend convention §3 ghi thẻ trích dẫn "có dấu '✓ đã xác minh on-chain'". Spec Q-10 và AP-07-AC02 đã chốt dấu hai dòng, và cấm hiện dòng chính mà thiếu dòng phụ | Đã sửa frontend convention §3 theo Q-10 (spec thắng). W3 cài theo spec |
| L-2 | design-system §4.1 ghi badge "nền nhạt + chữ đậm cùng tông". Với `refund` và `expired` thì không đạt AA (§8.1) | Đã sửa design-system §4.1 theo U-11: cả bốn badge dùng chữ `ink`, icon và nền mang tông màu |
| L-3 | ui-pages §4.2 ghi `PENDING · DEPOSITING` là badge "ĐANG GIỮ TIỀN (xanh dương)" và câu bị hoàn tiền là "mờ đi". Thiết kế này (và `StatusBadge` chỉ có bốn giá trị) dùng ĐANG XỬ LÝ cho mọi `PENDING`, và "mờ đi" là chữ `ink-muted` (§4.1) | Đã sửa ui-pages §4.2 (xếp dưới thiết kế đã duyệt theo [docs/README.md](../README.md)) |

## 13. Câu hỏi đã chốt (owner duyệt theo đề xuất)

| Mã | Câu hỏi | Đề xuất |
|---|---|---|
| U-11 | Badge `expired` chữ cùng tông chỉ đạt 4,28:1 (cần 4,5). Đổi cả bốn badge sang chữ `ink` + icon cùng tông, hay chỉ đổi `refund` và `expired`? | **Cả bốn dùng chữ `ink`** (13,3–13,8:1), icon và nền nhạt mang tông màu, để bốn badge trông cùng một kiểu. Ghi vào design-system §4.1 |
| U-12 | Trong lúc đang xử lý, API có thể đã có `answer` (stage `CHECKING`). Có hiện trước khi chốt không? | **Không.** Skeleton tới khi đã chốt. Lý do: câu chưa qua kiểm tra mà hiện như câu trả lời thì đi ngược tinh thần AP-07-AC03. Đổi lại, người dùng chờ thêm vài giây |
| U-13 | `PAID` mà chưa đối chiếu được (`verifiedOnChain = false`): thử lại mấy lần? | 4 lần, giãn 3/6/12/24 giây (khoảng 45 giây), rồi dừng và giữ dòng "Chưa đối chiếu được…". Tải lại trang thì thử lại từ đầu |
| U-14 | "Hỏi lại" khi `ANSWER_FAILED`: điền sẵn câu hỏi vào form trang Hỏi? Việc này đụng form W2 (`?q=` cần `useSearchParams` trong ranh giới `Suspense`) | **Có, qua `/?q=<câu hỏi>`.** AskForm đọc `q` một lần làm giá trị đầu, rồi xoá `q` khỏi URL bằng `router.replace`. Câu hỏi là dữ liệu công khai sẵn trên trang này nên không lộ thêm gì. Nếu owner không muốn đụng W2, dùng link `/` thường |
| U-15 | `CLAIMABLE` poll chậm 10 giây ở W3, trong khi W5 mới có nút. Chấp nhận để `CLAIMABLE` tự đổi sang `PAID` nếu server chốt muộn? | Đồng ý (contracts.md §4 cho phép `settle` sau `deadline`). Tắt poll khi tab ở nền |

## 14. Ngoài phạm vi W3

- Nút "Nhận lại tiền" và đọc trạng thái thẳng từ contract khi API sập (W5).
- Giao diện kiểm `citationsHash` (Q-13).
- Chia sẻ mạng xã hội, ảnh OG.
- In trang.
- Hiện địa chỉ người hỏi.
- Đếm ngược tới `deadline`.
- Chế độ tối.
