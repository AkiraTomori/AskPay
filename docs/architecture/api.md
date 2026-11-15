# 🔌 AskPay — API Reference

> Hình dạng chính xác của request/response là schema zod trong `packages/shared/src/api.ts`. File này mô tả hành vi và ví dụ; **khi lệch nhau, schema trong code thắng** và file này phải sửa trong cùng PR.
>
> **Trạng thái:** đã cài đặt A4 đến A6 (xem "Trạng thái triển khai" ở các mục dưới). Quy ước lỗi và lớp code ở [`../conventions/backend.md`](../conventions/backend.md).

## 1. Quy ước chung

- Base path `/api`. Web gọi cùng origin; Next rewrite `/api/*` sang `apps/api`.
- JSON UTF-8. Số tiền luôn là **chuỗi số nguyên** theo đơn vị nhỏ nhất của token (`"50000"` = 0,05 USDC), không dùng số thực.
- Địa chỉ ví và hash ở dạng hex có `0x`, chữ thường.
- Không có đăng nhập. Ví là danh tính; ví chỉ xuất hiện qua chữ ký thanh toán.

### Phản hồi

- Thành công: `{ "data": …, "meta"?: … }`.
- Lỗi: `{ "error": { "code": "…", "message": "…", "details"?: … } }`. `message` là câu tiếng Việt lấy từ `packages/shared`.
- **Ngoại lệ:** phản hồi **402 báo giá** theo chuẩn x402 v2 (§3.1), không bọc envelope.

### Mã lỗi

| HTTP | `code` | Khi |
|---|---|---|
| 400 | `VALIDATION_FAILED` | Body sai schema; câu hỏi rỗng hoặc dài hơn 500 ký tự (đếm sau khi chuẩn hoá NFC và cắt khoảng trắng đầu cuối) |
| 402 | `PAYMENT_INVALID` | Chữ ký sai, hết hạn, sai số tiền, sai `to`, sai `nonce` |
| 404 | `QUESTION_NOT_FOUND` | Không có `qid`, hoặc báo giá đã hết hạn |
| 409 | `QUESTION_ALREADY_SETTLED` | Gửi lại thanh toán cho `qid` đã giữ tiền hoặc đã chốt; `details` chứa kết quả hiện tại |
| 409 | `QUESTION_MISMATCH` | Nội dung câu hỏi khác câu đã báo giá cho `qid` |
| 429 | `RATE_LIMITED` | Quá 20 báo giá mỗi phút mỗi IP (`RATE_LIMIT_PER_MINUTE`); hoặc quá 120 lần đọc mỗi phút mỗi IP ở các endpoint `GET` (`READ_RATE_LIMIT_PER_MINUTE`). Hai giới hạn đếm riêng. |
| 502 | `LLM_UNAVAILABLE` | Chỉ ở `/health`; trong `/ask`, lỗi LLM được chuyển thành hoàn tiền |
| 503 | `CHAIN_UNAVAILABLE` | **Trước khi** giữ tiền: RPC không trả lời, ví provider thiếu AVAX, hoặc hàng đợi tx đang lỗi. Sau khi đã giữ tiền thì không dùng mã này. |
| 500 | `INTERNAL_ERROR` | Lỗi không lường trước |

### Giới hạn tần suất và cache của các endpoint đọc

- Mọi `GET` dưới `/api` (`/questions`, `/questions/:qid`, `/stats`, `/corpus`, `/health`) dùng chung một giới hạn mỗi IP, mặc định **120 lần mỗi phút**. Trang kết quả poll một câu mỗi giây (60 lần mỗi phút) nên vẫn nằm trong giới hạn. Header `RateLimit` theo draft-7.
- Sau reverse proxy (Render, Railway) phải đặt `TRUST_PROXY_HOPS=1`. Không đặt thì mọi người gọi cùng một IP (của proxy) và chung một giới hạn.
- `/health`, `/stats` và **trang đầu** của `/questions` (không có `cursor`) được giữ **5 giây** trong bộ nhớ, và các request đến cùng lúc dùng chung một lần tải. Số liệu có thể cũ tối đa 5 giây. Câu trả lời `/health` báo RPC lỗi (503) **không** được giữ, nên khi RPC hồi phục thì request kế tiếp thấy ngay. Trang có `cursor`, `/questions/:qid` và `/corpus` không qua cache này (`/corpus` chỉ đọc root từ chain một lần).

### Không có endpoint (cố ý)

- **Rút tiền khi quá hạn:** gọi thẳng `claimRefund(qid)` từ ví trên trình duyệt, không qua backend (P5).
- **Đăng ký root, đổi provider hoặc checker:** chỉ bằng script Foundry của owner.

## 2. Danh sách endpoint (6)

| # | Method | Path | Mục đích | Tiêu chí |
|---|---|---|---|---|
| 1 | POST | `/api/ask` | Báo giá (402), hoặc trả tiền + trả lời + chốt | AP-02, AP-03, AP-04, AP-05 |
| 2 | GET | `/api/questions/:qid` | Kết quả và tiến trình | AP-07 |
| 3 | GET | `/api/questions` | Danh sách gần nhất | AP-08 |
| 4 | GET | `/api/stats` | Số liệu tổng từ event on-chain | AP-08 |
| 5 | GET | `/api/corpus` | Thông tin corpus, root có khớp on-chain không | AP-01-AC04 |
| 6 | GET | `/api/health` | Server, RPC, LLM, số dư ví provider | Vận hành |

## 3. `POST /api/ask`

### 3.1 Lần 1: báo giá

**Request**

```http
POST /api/ask
Content-Type: application/json

{ "question": "Thời gian thử việc tối đa với công việc cần bằng cao đẳng là bao lâu?" }
```

**Response `402 Payment Required`**

Header `PAYMENT-REQUIRED` là base64 của JSON dưới đây. Body là chính JSON đó, để client dễ đọc.

```json
{
  "x402Version": 2,
  "error": "PAYMENT_REQUIRED",
  "resource": { "url": "/api/ask", "description": "Một câu trả lời có trích dẫn Bộ luật Lao động 2019" },
  "accepts": [
    {
      "scheme": "escrow",
      "network": "eip155:43113",
      "asset": "0x5425890298aed601595a70ab815c96711a31bc65",
      "amount": "50000",
      "payTo": "0x<AskPayEscrow>",
      "maxTimeoutSeconds": 300,
      "extra": {
        "qid": "0x9f…",
        "authorization": "ReceiveWithAuthorization",
        "tokenName": "USD Coin",
        "tokenVersion": "2",
        "validBefore": "1762700000",
        "answerWindowSeconds": 600
      }
    }
  ]
}
```

- `asset` ở trên là địa chỉ USDC Fuji, đã xác nhận ở POC-1 (T-12). `MockUSDC` chỉ dùng trong test.
- `tokenName` và `tokenVersion` là domain EIP-712 của token. Lấy từ hàm `name()` và `version()` của token, không chép tay.

### 3.2 Lần 2: trả tiền

Client ký typed data:

```ts
domain = { name: tokenName, version: tokenVersion, chainId: 43113, verifyingContract: asset }
types  = { ReceiveWithAuthorization: [
  { name: 'from', type: 'address' }, { name: 'to', type: 'address' },
  { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' },
  { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' } ] }
message = { from: payer, to: payTo, value: amount, validAfter: 0, validBefore, nonce: qid }
```

**Request**

```http
POST /api/ask
Content-Type: application/json
PAYMENT-SIGNATURE: <base64(JSON)>

{ "question": "…(giống hệt lần 1)…", "qid": "0x9f…" }
```

JSON trong `PAYMENT-SIGNATURE`:

```json
{
  "x402Version": 2,
  "accepted": { "scheme": "escrow", "network": "eip155:43113", "...": "giống accepts[0]" },
  "payload": {
    "signature": "0x…65 byte",
    "authorization": { "from": "0x…", "to": "0x…", "value": "50000", "validAfter": "0", "validBefore": "1762700000", "nonce": "0x9f…" }
  }
}
```

**Response `200`** (chờ tối đa 60 giây, T-07)

Header `PAYMENT-RESPONSE` là base64 của `{ "success": true, "network": "eip155:43113", "transaction": "<depositTx>", "settleTransaction": "<settleTx>" }`.

```json
{
  "data": {
    "qid": "0x9f…",
    "question": "…",
    "status": "PAID",
    "stage": "PAID",
    "reason": null,
    "amount": "50000",
    "payer": "0xab…",
    "answer": "Theo Khoản 2 Điều 25, thời gian thử việc không quá 60 ngày…",
    "noBasis": false,
    "citations": [
      {
        "lawId": "0x…", "dieu": 25, "khoan": 2, "dieuTitle": "Thời gian thử việc",
        "quote": "không quá 60 ngày đối với công việc có chức danh nghề nghiệp cần trình độ chuyên môn, kỹ thuật từ cao đẳng trở lên",
        "text": "<nguyên văn đầy đủ của Khoản>",
        "textHash": "0x…",
        "quoteHash": "0x…",
        "verifiedOnChain": true
      }
    ],
    "answerHash": "0x…",
    "citationsHash": "0x…",
    "tx": { "deposit": "0x…", "settle": "0x…" },
    "deadline": 1762700600,
    "createdAt": 1762699400000
  }
}
```

**Trường cam kết trích dẫn** (T-13, [contracts §4.4](./contracts.md)):

- `quote` là chuỗi đã chuẩn hoá. `quoteHash = keccak256(utf8(quote))`.
- `citations[]` giữ **đúng thứ tự** đã gửi `settle`. `citationsHash` là hash checker đã ký. Khi `PAID`, nó bằng `citationsHash` trong event `Paid`.
- Người ngoài kiểm lại được mà không cần tin server, bằng `citationsHash()` của `packages/shared`. Băm lại `quote` của từng thẻ, dựng `Citation[]` với `lawId`, `dieu`, `khoan`, `textHash`, `quoteHash`, rồi tính hash. Kết quả phải bằng `citationsHash` trong event `Paid` của tx `settle` trên Snowtrace. v1 không có giao diện cho bước này (spec Q-13).
- `answerHash` và `citationsHash` là `null` cho tới khi checker đã ký. Ví dụ: câu đang ở `ANSWERING`, hoặc bị hoàn tiền `NO_CITATION` hay `ANSWER_FAILED`.

**Ý nghĩa của `verifiedOnChain`.** Đây là cờ do server tính theo quy tắc P2 ở system-design §7. Cờ này điều khiển dấu xác minh hai dòng trên thẻ trích dẫn (spec AP-07-AC02, Q-10). Nó **không** có nghĩa contract đã kiểm đoạn trích nằm trong nguyên văn: việc đó do checker kết luận và ký.

| Tình huống | `verifiedOnChain` |
|---|---|
| Chưa có event (`PENDING`, `CLAIMABLE`) | `false` |
| `REFUNDED` | `false` |
| `PAID`, và hash tính lại từ `answer` và `citations[]` đang trả về khớp `answerHash` và `citationsHash` trong log `Paid` đọc qua RPC (không qua DB) | `true`. Ý nghĩa: Khoản có trong luật đã đăng ký, và đoạn trích đúng là đoạn checker đã ký. |
| `PAID` nhưng hash không khớp (DB bị sửa hoặc ghi sai) | `false` cho mọi thẻ; server log `CITATIONS_MISMATCH` |
| `PAID` nhưng RPC lỗi lúc đọc receipt | `false`, tạm thời; lần gọi sau đọc lại |

Câu bị hoàn tiền vẫn trả `200`, với `status: "REFUNDED"` và `reason: "CHECKER_REJECTED"` (hoặc lý do khác). **Hoàn tiền là kết quả đúng, không phải lỗi HTTP.** Có hiện câu trả lời hay không phụ thuộc Q-04.

### 3.3 Các trường hợp đặc biệt

| Tình huống | Phản hồi |
|---|---|
| `qid` không có hoặc báo giá đã hết hạn | `404 QUESTION_NOT_FOUND`; client xin báo giá mới |
| Chữ ký hỏng | `402 PAYMENT_INVALID`, không có tx nào được gửi |
| Gửi lại cùng chữ ký (replay) | `409 QUESTION_ALREADY_SETTLED` kèm `details` = kết quả hiện tại; không trừ tiền lần 2 |
| Client mất kết nối giữa chừng | Server vẫn chạy tiếp tới khi chốt; client mở `/questions/<qid>` để xem |
| Quá 60 giây mà chưa chốt | `202` kèm `{ data: { qid, stage } }` (`askAcceptedSchema` trong `packages/shared`); client chuyển sang poll |
| Hai request cùng chữ ký tới đồng thời | Chỉ một request gửi deposit. Request còn lại nhận `409 QUESTION_ALREADY_SETTLED`, `details` là trạng thái hiện tại. |
| `validBefore` còn dưới 60 giây | `402 PAYMENT_INVALID`, không gửi tx |
| Người hỏi không đủ token (AP-03-AC05) | `402 PAYMENT_INVALID`, `details` = `{ reason: "INSUFFICIENT_BALANCE", balance, price, faucetUrl }` (`insufficientBalanceDetailsSchema` trong `packages/shared`). Không có tx nào được gửi. |
| Ví provider không đủ AVAX, hoặc hàng đợi tx đang lỗi | `503 CHAIN_UNAVAILABLE` **trước khi** giữ tiền |
| Đã gửi deposit nhưng chưa biết kết quả | `202 { data: { qid, stage: "DEPOSITING" } }`. **Không** trả 402, để client không xin báo giá mới và trả tiền lần hai. |
| LLM lỗi hoặc checker lỗi sau khi đã giữ tiền | `200`, `status: "REFUNDED"`, `reason: "ANSWER_FAILED"` (qua `refundByProvider`). Không trả mã 5xx. |
| Server không chốt được (sai khoá, tx kẹt) | `202`, rồi poll. Tới `deadline` thì `status: "CLAIMABLE"` và người hỏi tự nhận lại tiền. |

**Trạng thái triển khai (A5):** `POST /api/ask` chạy trọn luồng: giữ tiền, trả lời, kiểm tra, chốt.
- Request chờ tối đa 60 giây (`REQUEST_WAIT_MS`). Chốt xong trong thời gian đó thì trả `200` với kết quả (Paid hoặc Refunded, kèm `settleTransaction` ở `PAYMENT-RESPONSE`). Quá 60 giây thì trả `202 { qid, stage }` và pipeline vẫn chạy tiếp.
- Đã giữ tiền nhưng chưa biết kết quả deposit: `202 { stage: "DEPOSITING" }`. Server đối chiếu tiếp theo nonce, không cần request.
- Khi khởi động, server từ chối chạy nếu: khoá provider hoặc khoá checker không phải `provider()` và `checker()` trên chain, hoặc root corpus dựng lại khác `lawRoot` đã đăng ký.

**Trạng thái triển khai (A6):** `GET /api/questions/:qid`, `/questions`, `/stats`, `/corpus`, `/health` đã có, cùng indexer đọc event vào `chain_events`.
- `verifiedOnChain` do server tính theo bảng trên, **mỗi lần** trả kết quả: đọc receipt của tx chốt qua RPC (kiểm địa chỉ escrow và `qid`), rồi tính lại `answerHash` từ `answer` và `citationsHash` từ `citations[]` (`quoteHash` băm lại từ `quote`, không đọc cột đã lưu). Chỉ **sự kiện** `Paid` được cache (theo `qid` và tx), không cache kết luận, nên sửa DB sau lần đọc đầu thì dấu tắt. Một thẻ chỉ có dấu khi `status` là `PAID`.
- `deadline` có trong kết quả khi indexer đã thấy `Deposited` của câu đó.

Chi tiết từng đường lỗi: [system-design §5.6](./system-design.md).

## 4. `GET /api/questions/:qid`

Trả cùng hình dạng `data` như §3.2. Câu ở trạng thái `QUOTED` hoặc `EXPIRED` chỉ có `qid`, `question`, `stage`.

`qid` sai định dạng hoặc không có thì `404 QUESTION_NOT_FOUND`. Chữ hoa trong hex được chấp nhận.

Các giá trị `stage` khi đang xử lý: `DEPOSITING`, `ANSWERING`, `CHECKING`, `SETTLING`. Web poll mỗi 1 giây cho tới khi `status` thuộc `PAID`, `REFUNDED`.

`status` là trạng thái tiền, lấy theo P2:
- `PENDING`: chưa có event.
- `PAID` / `REFUNDED`: lấy từ event on-chain (`chain_events`, do indexer đọc). Có event thì event thắng `stage` trong DB: `status`, `stage`, `reason`, `amount`, `tx.settle` đều theo event (AP-08-AC02). `tx.settle` của câu người hỏi tự `claimRefund` là tx của lệnh rút đó.
- `CLAIMABLE`: chưa có event đóng, indexer đã thấy `Deposited` và `deadline` (giây) đã qua theo đồng hồ server; web hiện nút "Nhận lại tiền" (web vẫn mô phỏng `claimRefund` trước khi mở ví, §5.6 E).

## 5. `GET /api/questions?limit=20&cursor=<base64>`

```json
{
  "data": [ { "qid": "0x…", "question": "…(cắt 120 ký tự)", "status": "PAID", "reason": null, "amount": "50000", "createdAt": 1762699400000, "tx": { "settle": "0x…" } } ],
  "meta": { "nextCursor": "eyJ…" }
}
```

Sắp xếp `createdAt` giảm dần, cùng `createdAt` thì theo `qid` giảm dần, nên cursor không bỏ sót hay lặp. `limit` từ 1 đến 100 (mặc định 20). `meta.nextCursor` chỉ có khi còn trang sau. Cursor hỏng hoặc `limit` ngoài khoảng thì `400 VALIDATION_FAILED`. Chỉ liệt kê câu đã giữ tiền (bỏ `QUOTED`, `EXPIRED`). `status` và `reason` theo event on-chain nếu indexer đã đọc (§4); văn bản câu hỏi chỉ có trong DB, nên câu còn trên chain mà DB mất thì không có dòng ở đây (nhưng vẫn nằm trong `/stats`).

## 6. `GET /api/stats`

```json
{
  "data": {
    "questions": 42, "paid": 31, "refunded": 11,
    "refundRate": 0.262,
    "refundsByReason": { "NO_CITATION": 6, "INVALID_CITATION": 1, "CHECKER_REJECTED": 3, "ANSWER_FAILED": 0, "TIMEOUT": 1 },
    "providerRevenue": "1550000",
    "lastIndexedBlock": 38123456,
    "eval": { "runAt": "2026-11-18", "commit": "abc1234", "citationAccuracy": 0.82, "checkerPassRate": 0.78, "outOfScopeCorrect": 0.9 }
  }
}
```

- `eval` đọc từ file `eval/results/latest.json` (AP-09-AC03). Chưa chạy eval, file thiếu hoặc sai định dạng thì `eval: null`.
- Các số khác tính từ `chain_events` (AP-08-AC02), không đọc bảng `questions`.
- `questions` là số `qid` có event `Deposited`; `paid` và `refunded` là số `qid` có `Paid` và `Refunded`. `refundRate = refunded / (paid + refunded)`: tỉ lệ trên những câu đã chốt, câu đang xử lý chưa tính. `providerRevenue` là tổng `amount` của các event `Paid` (cộng bằng BigInt). `refundsByReason` luôn có đủ năm lý do, giá trị 0 nếu chưa có.
- `lastIndexedBlock` là checkpoint của indexer. Số liệu chỉ phủ các block indexer đã đọc: để khớp Snowtrace cho toàn bộ escrow, `SCAN_LOOKBACK_BLOCKS` phải chạm `deploymentBlock` ở lần chạy đầu của một DB mới. Ngoại lệ: DB demo bắt đầu ở block 61067095, nên `/stats` thiếu 7 tx thử đầu tiên và bằng số hàng của `/questions` (system-design §5.6 F).

## 7. `GET /api/corpus`

```json
{
  "data": {
    "lawId": "0x…", "lawName": "Bộ luật Lao động 2019 (45/2019/QH14)",
    "khoanCount": 1043, "dieuCount": 220,
    "repoRoot": "0x…", "onChainRoot": "0x…", "rootMatches": true,
    "escrow": "0x…", "explorer": "https://testnet.snowtrace.io/address/0x…"
  }
}
```

Số `khoanCount` ở trên chỉ là ví dụ; giá trị thật lấy từ kết quả parse. `onChainRoot` đọc trực tiếp từ escrow mỗi lần gọi; RPC lỗi thì `503 CHAIN_UNAVAILABLE`.

## 8. `GET /api/health`

```json
{ "data": { "ok": true, "rpc": "ok", "llm": "ok", "providerBalanceAvax": "1.42", "lowBalance": false, "indexerLagBlocks": 3 } }
```

- `rpc: "down"` kèm HTTP 503 khi RPC không trả lời. Hàng đợi tx đang lỗi (§5.6 C) thì `ok: false` nhưng vẫn HTTP 200.
- Số dư dưới 0,2 AVAX thì `lowBalance: true`, nhưng không chặn. `providerBalanceAvax` hiện hai chữ số thập phân (cắt, không làm tròn).
- `llm` là kết quả của **lần gọi LLM gần nhất** trong process này, chưa có lần nào thì `ok`. `/health` không bao giờ gọi mô hình, để người ping không ăn hết hạn mức mỗi ngày của Groq.
- `indexerLagBlocks` là số block indexer còn phải đọc; trước lần quét đầu tiên là cả cửa sổ lùi.

## 9. Luồng chính

### Hỏi và Paid
1. `POST /ask` → 402.
2. Ký.
3. `POST /ask` + `PAYMENT-SIGNATURE`.
4. Trong lúc chờ, poll `GET /questions/:qid` để hiện từng bước.
5. Nhận 200 `PAID`. Chuyển trang `/questions/:qid`.

### Hỏi ngoài phạm vi
Giống luồng trên. Kết quả là 200 `REFUNDED`, `reason: NO_CITATION`, `noBasis: true`.

### Server sập sau khi giữ tiền
1. Web poll thấy `status: CLAIMABLE` sau `deadline`, hoặc gọi API không được thì tự đọc `questions(qid)` on-chain qua viem.
2. Nút "Nhận lại tiền" gọi `claimRefund(qid)` từ ví.
3. Event `Refunded(TIMEOUT)`.

## 10. Ma trận phủ

| Tiêu chí | Endpoint / thao tác |
|---|---|
| AP-01-AC04 | `GET /corpus` |
| AP-02-AC01…03 | `POST /ask` (lần 1) |
| AP-03-AC01…05 | `POST /ask` (lần 2), ký trên web |
| AP-04, AP-05 | `POST /ask` (lần 2) |
| AP-06 | `claimRefund` từ ví, `status: CLAIMABLE` |
| AP-07 | `GET /questions/:qid` |
| AP-08 | `GET /questions`, `GET /stats` |
| AP-09-AC03 | `GET /stats` → `eval` |

## 11. Điểm mở

- ❓ Q-04: câu bị hoàn tiền có trả `answer` không. Đề xuất: có, kèm `status: REFUNDED` để UI gắn cảnh báo.
- ❓ Có cần `GET /api/corpus/khoan/:dieu/:khoan` riêng không. Hiện tại nguyên văn đã nằm trong `citations[].text`, nên chưa cần.
