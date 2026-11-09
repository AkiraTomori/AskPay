# 🔌 AskPay — API Reference

> Hình dạng chính xác của request/response là schema zod trong `packages/shared/src/api.ts`. File này mô tả hành vi và ví dụ; **khi lệch nhau, schema trong code thắng** và file này phải sửa trong cùng PR.
>
> **Trạng thái:** spec, chưa có code. Quy ước lỗi và lớp code ở [`../conventions/backend.md`](../conventions/backend.md).

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
| 400 | `VALIDATION_FAILED` | Body sai schema; câu hỏi rỗng hoặc dài hơn 500 ký tự |
| 402 | `PAYMENT_INVALID` | Chữ ký sai, hết hạn, sai số tiền, sai `to`, sai `nonce` |
| 404 | `QUESTION_NOT_FOUND` | Không có `qid`, hoặc báo giá đã hết hạn |
| 409 | `QUESTION_ALREADY_SETTLED` | Gửi lại thanh toán cho `qid` đã giữ tiền hoặc đã chốt; `details` chứa kết quả hiện tại |
| 409 | `QUESTION_MISMATCH` | Nội dung câu hỏi khác câu đã báo giá cho `qid` |
| 429 | `RATE_LIMITED` | Quá 20 báo giá mỗi phút mỗi IP (đề xuất) |
| 502 | `LLM_UNAVAILABLE` | Chỉ ở `/health`; trong `/ask`, lỗi LLM được chuyển thành hoàn tiền |
| 503 | `CHAIN_UNAVAILABLE` | RPC không trả lời **trước khi** giữ tiền |
| 500 | `INTERNAL_ERROR` | Lỗi không lường trước |

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

- `asset` ở trên là địa chỉ USDC Fuji, cần xác nhận lại ở POC-1. Nếu POC-1 không đạt thì đây là `MockUSDC` (T-12).
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
        "dieu": 25, "khoan": 2, "dieuTitle": "Thời gian thử việc",
        "quote": "không quá 60 ngày đối với công việc có chức danh nghề nghiệp cần trình độ chuyên môn, kỹ thuật từ cao đẳng trở lên",
        "text": "<nguyên văn đầy đủ của Khoản>",
        "textHash": "0x…",
        "verifiedOnChain": true
      }
    ],
    "tx": { "deposit": "0x…", "settle": "0x…" },
    "deadline": 1762700600,
    "createdAt": 1762699400000
  }
}
```

Câu bị hoàn tiền vẫn trả `200`, với `status: "REFUNDED"` và `reason: "CHECKER_REJECTED"` (hoặc lý do khác). **Hoàn tiền là kết quả đúng, không phải lỗi HTTP.** Có hiện câu trả lời hay không phụ thuộc Q-04.

### 3.3 Các trường hợp đặc biệt

| Tình huống | Phản hồi |
|---|---|
| `qid` không có hoặc báo giá đã hết hạn | `404 QUESTION_NOT_FOUND`; client xin báo giá mới |
| Chữ ký hỏng | `402 PAYMENT_INVALID`, không có tx nào được gửi |
| Gửi lại cùng chữ ký (replay) | `409 QUESTION_ALREADY_SETTLED` kèm `details` = kết quả hiện tại; không trừ tiền lần 2 |
| Client mất kết nối giữa chừng | Server vẫn chạy tiếp tới khi chốt; client mở `/questions/<qid>` để xem |
| Quá 60 giây mà chưa chốt | `202` kèm `{ data: { qid, stage } }`; client chuyển sang poll |

## 4. `GET /api/questions/:qid`

Trả cùng hình dạng `data` như §3.2. Câu ở trạng thái `QUOTED` hoặc `EXPIRED` chỉ có `qid`, `question`, `stage`.

Các giá trị `stage` khi đang xử lý: `DEPOSITING`, `ANSWERING`, `CHECKING`, `SETTLING`. Web poll mỗi 1 giây cho tới khi `status` thuộc `PAID`, `REFUNDED`.

`status` là trạng thái tiền, lấy theo P2:
- `PENDING`: chưa có event.
- `PAID` / `REFUNDED`: lấy từ event on-chain.
- `CLAIMABLE`: còn `Open` nhưng đã quá `deadline`; web hiện nút "Nhận lại tiền".

## 5. `GET /api/questions?limit=20&cursor=<base64>`

```json
{
  "data": [ { "qid": "0x…", "question": "…(cắt 120 ký tự)", "status": "PAID", "reason": null, "amount": "50000", "createdAt": 1762699400000, "tx": { "settle": "0x…" } } ],
  "meta": { "nextCursor": "eyJ…" }
}
```

Sắp xếp `createdAt` giảm dần. Chỉ liệt kê câu đã giữ tiền (bỏ `QUOTED`, `EXPIRED`).

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

- `eval` đọc từ file `eval/results/latest.json` (AP-09-AC03). Chưa chạy eval thì `eval: null`.
- Các số khác tính từ `chain_events` (AP-08-AC02).

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

Số `khoanCount` ở trên chỉ là ví dụ; giá trị thật lấy từ kết quả parse.

## 8. `GET /api/health`

```json
{ "data": { "ok": true, "rpc": "ok", "llm": "ok", "providerBalanceAvax": "1.42", "lowBalance": false, "indexerLagBlocks": 3 } }
```

`ok = false` (HTTP 503) khi RPC không trả lời. Số dư dưới 0,2 AVAX thì `lowBalance: true`, nhưng không chặn.

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
