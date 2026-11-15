# 🖥️ AskPay — Thiết kế các trang UI

> Hành vi và tiêu chí chấp nhận ở [spec AP-02, AP-03, AP-06, AP-07, AP-08](../spec/askpay-v1.md). Giao diện (màu, chữ, component) bắt buộc theo [`design-system.md`](./design-system.md). Quy tắc code ở [`../conventions/frontend.md`](../conventions/frontend.md).
>
> **Trạng thái:** đã cài đặt trang hỏi, kết quả (W1 đến W3) và `/dashboard` (W4, đang làm); `/verify` (W5) chưa. Chi tiết từng slice ở [design/](../design/); khi lệch thì design của slice thắng.

## 1. Sơ đồ trang

| Route | Tên | Mục đích | Ưu tiên |
|---|---|---|---|
| `/` | Hỏi | Nhập câu hỏi, trả tiền, xem tiến trình | P0 |
| `/questions/[qid]` | Kết quả | Câu trả lời, trích dẫn, trạng thái tiền, link tx; nhận lại tiền khi quá hạn | P0 |
| `/dashboard` | Dashboard | Số liệu công khai và danh sách câu gần nhất | P1 |
| `/verify` | Tự xác minh | Root trong repo so với root on-chain; địa chỉ contract; hướng dẫn tự kiểm | P2 (cắt được) |

### 1.1 Điều hướng theo trạng thái

- Chuyển sang `/questions/<qid>` khi tiền chắc chắn đã vào escrow hoặc server đã nhận việc: POST lần hai trả 200, 202 hay 409 đã chốt, hoặc `stage` đã tới `ANSWERING` trở đi. `DEPOSITING` chưa đủ, vì server còn có thể đưa câu về `QUOTED`. Trang kết quả tiếp tục poll. ([W2 §6.2](../design/w2-ask.md), U-09)
- Mở `/questions/<qid>` của câu đã chốt thì hiện kết quả ngay, không poll.
- `qid` không tồn tại thì hiện trạng thái "Không tìm thấy câu hỏi", có nút về trang Hỏi.

### 1.2 Thứ tự làm (theo lịch)

W1 shell + ví → W2 trang Hỏi + `useAsk` → W3 trang Kết quả → W4 Dashboard → W5 Nhận lại tiền + `/verify`.

## 2. App shell (mọi trang)

```
┌────────────────────────────────────────────────────────────────┐
│ ⚖ AskPay   Hỏi · Dashboard · Xác minh        [Fuji] [0xab…cd ▾] │  Header
├────────────────────────────────────────────────────────────────┤
│                         (nội dung trang)                        │
├────────────────────────────────────────────────────────────────┤
│ ⓘ Thông tin tham khảo, không thay thế tư vấn pháp lý.           │  DisclaimerBanner (luôn hiện)
│ Contract 0x12…ef ↗ · Bộ luật Lao động 2019 (45/2019/QH14)        │  Footer
└────────────────────────────────────────────────────────────────┘
```

- `ConnectButton`: chưa kết nối thì hiện nút "Kết nối ví"; đã kết nối thì hiện địa chỉ rút gọn và số dư USDC.
- `NetworkGuard`: ví không ở Fuji thì hiện thanh vàng trên cùng "Đang ở sai mạng" và nút "Chuyển sang Avalanche Fuji".
- Responsive: ≥ 1024px nội dung rộng 768px, căn giữa; < 640px header gập thành menu.

## 3. `/` — Hỏi

```
┌──────────────────────────────────────────────┐
│  Hỏi về Bộ luật Lao động 2019                 │
│  Trả theo câu. Không qua kiểm tra thì hoàn tiền.│
│ ┌──────────────────────────────────────────┐ │
│ │ Ví dụ: Thử việc tối đa bao lâu?           │ │  QuestionForm (textarea, đếm 0/500)
│ └──────────────────────────────────────────┘ │
│  Gợi ý: [Thử việc] [Làm thêm giờ] [Nghỉ việc] │  chip câu mẫu
│  Giá: 0,05 USDC (~1.300đ) · hoàn tiền nếu …   │  PriceTag (chỉ hiện sau khi có báo giá)
│                     [ Hỏi ]                    │
└──────────────────────────────────────────────┘
```

### 3.1 Trạng thái của nút và form

| Trạng thái | Nút | Thông báo |
|---|---|---|
| Ô trống | Vô hiệu | — |
| Quá 500 ký tự | Vô hiệu | "Câu hỏi tối đa 500 ký tự" ngay dưới ô |
| Chưa kết nối ví | "Kết nối ví để hỏi" (mở hộp kết nối) | — |
| Sai mạng | "Chuyển sang Fuji" | thanh `NetworkGuard` |
| Đang lấy báo giá | Spinner, vô hiệu | — |
| Có báo giá, đủ USDC | "Ký và trả 0,05 USDC" | PriceTag + dòng "Tiền vào escrow, không vào ví của AskPay" |
| Có báo giá, thiếu USDC | Vô hiệu | "Số dư 0,01 USDC, cần 0,05. [Lấy USDC testnet ↗]" (AP-03-AC05) |
| Đang chờ ký | "Xác nhận trong ví…", vô hiệu | — |
| Người dùng từ chối ký | Về trạng thái "Có báo giá" | "Bạn đã huỷ ký. Câu hỏi vẫn còn đây." |
| Báo giá hết hạn (5 phút) | "Lấy giá mới" | — |
| Chữ ký bị từ chối (`PAYMENT_INVALID`) | "Lấy giá mới" (lấy báo giá mới và ký lại, không gửi lại chữ ký cũ; [W2 U-07](../design/w2-ask.md)) | Câu lỗi lấy từ `packages/shared` |

Gửi xong thì chuyển sang `/questions/<qid>`.

## 4. `/questions/[qid]` — Kết quả

```
┌──────────────────────────────────────────────────────┐
│ "Thử việc tối đa bao lâu nếu cần bằng cao đẳng?"      │
│ [● ĐÃ THANH TOÁN]  0,05 USDC · 09/11 21:40 · tx ↗      │  StatusBadge + TxLink
├──────────────────────────────────────────────────────┤
│ ✓ Đã giữ tiền  ✓ Đã trả lời  ✓ Đã kiểm tra  ✓ Đã chốt   │  StepTimeline
├──────────────────────────────────────────────────────┤
│ Theo Khoản 2 Điều 25, thời gian thử việc không quá …   │  AnswerBody
├──────────────────────────────────────────────────────┤
│ Căn cứ                                                 │
│ ┌──────────────────────────────────────────────────┐ │
│ │ Điều 25 · Khoản 2 — Thời gian thử việc            │ │  CitationCard
│ │ “không quá 60 ngày đối với công việc …”           │ │  (đoạn trích, chữ serif)
│ │ ✓ Khoản có trong luật đã đăng ký on-chain         │ │
│ │   Đoạn trích và mức liên quan: checker đã ký       │ │
│ │                              [Xem nguyên văn ▾]    │ │
│ └──────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
```

### 4.1 Component và nguồn dữ liệu

| Component | Dữ liệu | Nguồn |
|---|---|---|
| `StatusBadge` | `status`, `reason` | `GET /questions/:qid` (theo P2: từ event) |
| `StepTimeline` | `stage` | poll 1 giây cho tới khi chốt |
| `AnswerBody` | `answer`, `noBasis` | |
| `CitationCard` | `citations[]` | Dấu hai dòng (spec AP-07-AC02) chỉ hiện khi `verifiedOnChain = true`, tức `PAID` và hash khớp log `Paid` đọc qua RPC (api.md §3.2, Q-13). Web không tự tính cờ này. |
| `TxLink` | `tx.deposit`, `tx.settle` | link `testnet.snowtrace.io/tx/…` |
| `ClaimRefundButton` | `status = CLAIMABLE` | gọi `claimRefund(qid)` bằng wagmi |

### 4.2 Các trạng thái

| `status` / `stage` | Badge | Nội dung |
|---|---|---|
| `PENDING` · `DEPOSITING` | ĐANG XỬ LÝ (xanh dương) | Timeline bước 1 đang chạy |
| `PENDING` · `ANSWERING` / `CHECKING` / `SETTLING` | ĐANG XỬ LÝ | Timeline theo bước; khung trả lời là skeleton |
| `PAID` | ĐÃ THANH TOÁN (xanh lá) | Câu trả lời + thẻ trích dẫn có ✓ |
| `REFUNDED` · `NO_CITATION` | ĐÃ HOÀN TIỀN (hổ phách) | "Không tìm thấy căn cứ trong Bộ luật Lao động 2019" + câu lý do |
| `REFUNDED` · `INVALID_CITATION` / `CHECKER_REJECTED` | ĐÃ HOÀN TIỀN (hổ phách) | Khung cảnh báo: "Câu trả lời dưới đây **không đạt kiểm tra**, đừng dựa vào nó." Câu trả lời chữ `ink-muted` (không dùng `opacity`); thẻ trích dẫn **không** có ✓ (theo Q-04) |
| `REFUNDED` · `ANSWER_FAILED` | ĐÃ HOÀN TIỀN | "Hệ thống không trả lời được lúc này, bạn đã được hoàn tiền." Nút "Hỏi lại" |
| `CLAIMABLE` | QUÁ HẠN (xám) | "Đã quá 10 phút mà chưa có kết quả." Nút **Nhận lại tiền** |
| `REFUNDED` · `TIMEOUT` | ĐÃ HOÀN TIỀN | "Tiền đã được trả lại vào ví của bạn." Có câu trả lời thì hiện chữ `ink-muted` kèm "Câu trả lời dưới đây **chưa qua kiểm tra**, đừng dựa vào nó." |
| Lỗi tải trang | — | "Không tải được kết quả." Nút "Thử lại" (khác với không tìm thấy) |
| Không tìm thấy | — | "Không tìm thấy câu hỏi này." |

**Quy tắc cứng:** chữ "Đã thanh toán", "Đã hoàn tiền" và dấu ✓ chỉ hiện khi đã có event on-chain (AP-07-AC03).

### 4.3 Nút Nhận lại tiền (AP-06-AC03)

- Chỉ hiện khi `status = CLAIMABLE`.
- Ai bấm cũng được; tiền luôn về đúng ví người hỏi. Nút ghi rõ "Tiền sẽ về ví 0xab…cd".
- Đang chờ ký → đang chờ tx → xong thì badge đổi sang ĐÃ HOÀN TIỀN · TIMEOUT.
- Mô phỏng `claimRefund` trước khi mở ví. Nếu câu đã được server chốt (revert `QuestionNotOpen`), hoặc tx của người hỏi revert vì lý do đó, thì không báo lỗi. Tải lại trang và hiện trạng thái cuối ([system-design §5.6 E](../architecture/system-design.md)).
- Nếu API sập: trang vẫn đọc trạng thái trực tiếp từ contract (`questions(qid)`) qua viem để hiện nút.

## 5. `/dashboard`

```
┌───────────┬───────────┬───────────┬───────────┐
│ 42 câu    │ 31 đã trả │ 11 hoàn   │ 1,55 USDC │  StatTiles ×4
│           │           │ 26,2%     │ Provider đã nhận │
├───────────┴───────────┴───────────┴───────────┤
│ Lý do hoàn tiền: NO_CITATION 6 · CHECKER 3 …  │  RefundReasonList
├───────────────────────────────────────────────┤
│ Chất lượng (eval 18/11, commit abc1234)        │
│ Trích đúng Khoản 82% · Đạt checker 78% · …     │  EvalPanel
├───────────────────────────────────────────────┤
│ Câu hỏi gần nhất                               │
│ 21:40  Thử việc tối đa…   ĐÃ THANH TOÁN  tx ↗  │  QuestionTable (bấm dòng → /questions/qid)
│ …                               [Xem thêm]     │
└───────────────────────────────────────────────┘
```

- Thiết kế chi tiết, trạng thái và chuỗi giao diện: [design/w4-dashboard.md](../design/w4-dashboard.md) (đã duyệt 15/11/2026). Sơ đồ trên chỉ để phác bố cục.
- Nguồn: `GET /stats`, `GET /questions`.
- Ghi chú nhỏ dưới thẻ số liệu: "Tính từ event on-chain, khối #38123456."
- Rỗng: "Chưa có câu hỏi nào. [Hỏi câu đầu tiên]". Chưa chạy eval thì ẩn `EvalPanel`.

## 6. `/verify` — Tự xác minh

- Thẻ **Bộ luật**: tên, `lawId`, số Điều/Khoản, root trong repo, root on-chain, ✓ khớp / ✗ lệch.
- Thẻ **Contract**: địa chỉ escrow, provider, checker (link Snowtrace), `answerWindow`.
- Hướng dẫn 3 bước tự kiểm: clone repo → `npm run corpus` → so root với `cast call <escrow> "lawRoot(bytes32)" <lawId>`.
- Nguồn: `GET /corpus` + đọc trực tiếp contract.

## 7. Ma trận Trang ↔ API ↔ Chain

| Trang | API | Đọc chain trực tiếp | Ghi chain từ ví |
|---|---|---|---|
| `/` | `POST /ask` ×2 | số dư USDC (wagmi) | ký typed data (không gửi tx) |
| `/questions/[qid]` | `GET /questions/:qid` (poll) | `questions(qid)` khi API lỗi | `claimRefund(qid)` |
| `/dashboard` | `GET /stats`, `GET /questions` | — | — |
| `/verify` | `GET /corpus` | `lawRoot`, `provider`, `checker` | — |

## 8. Chuỗi giao diện

Mọi chuỗi tiếng Việt gom trong `features/<tên>/messages.ts`. Câu lỗi và câu lý do hoàn tiền lấy từ `packages/shared/src/errors.ts` (bảng ở [contracts.md §6](../architecture/contracts.md#6-error--mã-lý-do--câu-tiếng-việt)).
