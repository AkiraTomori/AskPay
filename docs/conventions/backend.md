# Backend convention (TypeScript, Express 5)

Áp dụng cho `apps/api`. Bản đầy đủ của cây module và ranh giới ở [codebase.md](../architecture/codebase.md); mã lỗi đầy đủ ở [api.md](../architecture/api.md). Rút từ convention backend của Fablewelf, bỏ phần cơ sở dữ liệu quan hệ và xác thực người dùng (AskPay không có tài khoản; ví là danh tính).

## 1. Cấu trúc: theo tính năng, tối đa 3–4 file mỗi module

```
apps/api/src/
  app.ts                 # dựng Express: middleware, mount module, middleware lỗi
  server.ts              # listen
  shared/
    config.ts            # đọc và kiểm env một lần bằng zod; nơi DUY NHẤT đọc process.env
    logger.ts            # pino
    errors.ts            # AppError + middleware lỗi
    http.ts              # validate bằng schema zod, gửi envelope
    chain.ts             # một viem publicClient + walletClient cho cả process
    tx-queue.ts          # hàng đợi gửi tx tuần tự cho ví provider (T-10)
    store.ts             # một kết nối SQLite cho cả process
  modules/
    ask/                 # POST /ask: điều phối trả tiền → trả lời → kiểm tra → settle
      ask.routes.ts
      ask.service.ts
    payment/             # x402: dựng yêu cầu 402, đọc chữ ký EIP-3009, deposit/settle
      payment.service.ts
      payment.chain.ts   # gọi AskPayEscrow qua viem
    retrieval/           # tìm Điều/Khoản liên quan trong corpus
      retrieval.service.ts
    answer/              # gọi LLM, ép đầu ra JSON có trích dẫn
      answer.service.ts
    checker/             # so khớp nguyên văn + LLM-judge + ký verdict EIP-712
      checker.service.ts
    history/             # GET /questions, /stats, /corpus, /health
      history.routes.ts
      history.service.ts
      history.repository.ts   # SQLite
    indexer/             # poll getLogs → chain_events (T-09)
      indexer.service.ts
      indexer.repository.ts
apps/api/test/           # phản chiếu src/; harness ở gốc test/
```

- Gốc `src/` chỉ có `app.ts` và `server.ts`. File lẻ khác vào `shared/`.
- Hậu tố lớp: `.routes` · `.service` · `.repository` (SQLite) · `.chain` (gọi smart contract). Một module có tối đa 3 file trong `src/`; file thứ 4 phải có lý do ghi trong PR.
- Module không import `.repository` hay `.chain` của module khác; gọi `.service` của module đó.
- Schema zod của request/response nằm trong `packages/shared`, không trong `apps/api`.
- Tên thư mục và file: một từ hoặc `kebab-case`.

## 2. Trách nhiệm từng lớp

| Lớp | Được | Không được |
|---|---|---|
| routes | validate bằng schema từ `packages/shared`, đọc header x402, gọi service, trả envelope hoặc 402 | nghiệp vụ, gọi chain, gọi LLM |
| service | quy tắc nghiệp vụ, thứ tự các bước, quyết định Paid/Refunded | đọc `req`/`res`, SQL, tự dựng client viem |
| chain | gọi hàm contract, đợi receipt, đọc event | quyết định nghiệp vụ |
| repository | đọc/ghi SQLite | quyết định nghiệp vụ |

## 3. Lỗi và phản hồi (một cách duy nhất)

- Một `AppError(code, httpStatus, message, details?)`. Service `throw`, **một** middleware lỗi chung chuyển thành phản hồi. Không `try/catch` trong handler (Express 5 tự bắt lỗi async).
- Thành công: `{ "data": …, "meta"?: … }`. Lỗi: `{ "error": { "code", "message", "details"? } }`.
- **Ngoại lệ duy nhất:** khi thiếu hoặc sai thanh toán, trả **HTTP 402** đúng định dạng x402 v2 (header `PAYMENT-REQUIRED`, body là payment requirements) để client x402 chuẩn hiểu được. Không bọc envelope cho phản hồi này.
- `code` là hằng trong `packages/shared`. `message` cho người đọc. Không lộ stack, prompt hay khoá.

| HTTP | Mã | Khi |
|---|---|---|
| 400 | `VALIDATION_FAILED` | zod từ chối |
| 402 | *(phản hồi x402)* | chưa có `PAYMENT-SIGNATURE` |
| 402 | `PAYMENT_INVALID` | chữ ký sai, hết hạn, sai số tiền, sai `nonce`/`qid` |
| 404 | `QUESTION_NOT_FOUND` | không có `qid` |
| 409 | `QUESTION_ALREADY_SETTLED` | gửi lại thanh toán cho câu đã giữ tiền hoặc đã chốt |
| 409 | `QUESTION_MISMATCH` | nội dung câu hỏi khác câu đã báo giá cho `qid` |
| 429 | `RATE_LIMITED` | vượt giới hạn |
| 502 | `LLM_UNAVAILABLE` | LLM lỗi hoặc quá thời gian; tiền đã nằm trong escrow nên người hỏi được hoàn tiền |
| 503 | `CHAIN_UNAVAILABLE` | RPC Fuji không trả lời |
| 500 | `INTERNAL_ERROR` | lỗi không lường trước; chỉ log ở server |

## 4. Tiền và chain

- Số tiền luôn là `bigint` theo đơn vị nhỏ nhất của token (USDC có 6 số lẻ). Chỉ đổi sang chuỗi hiển thị ở frontend. Không `number`, không `parseFloat`.
- **Chain là nguồn sự thật** cho trạng thái tiền (`Open`, `Paid`, `Refunded`). SQLite chỉ lưu nội dung câu hỏi, câu trả lời và tx hash để hiển thị. Nếu hai bên lệch thì tin chain.
- Mỗi lệnh ghi lên chain: đợi receipt, kiểm `status`, log tx hash. Không coi "đã gửi" là "đã xong".
- Một ví server (provider) gửi tx tuần tự, không gửi song song (tránh trùng nonce của ví).
- Địa chỉ contract và ABI lấy từ `packages/shared` (sinh từ `contracts/deployments/`), không chép tay.
- Không có nhánh code nào nhắm mainnet trong MVP. `config.ts` từ chối mọi `CHAIN_ID` khác 43113.

## 5. LLM

- Prompt nằm trong file riêng của module (`answer.prompt.ts`, có thể là file thứ 4), không rải trong service.
- Đầu ra LLM luôn đi qua schema zod. Parse lỗi thì coi như "không có trích dẫn hợp lệ", không đoán.
- Trích dẫn chỉ được chọn trong các Khoản mà bước retrieval đã trả về (constrained output).
- Không log toàn bộ prompt hay câu hỏi của người dùng ở mức `info`; chỉ `qid` và độ dài.

## 6. Phong cách code

- TypeScript `strict`; không `any` nếu không có comment lý do.
- Hàm export thường, không `static class`. Hàm ≤ ~40 dòng, file ≤ ~300 dòng.
- Tên đầy đủ (`question`, `citation`, `payerAddress`), không viết tắt.
- Comment giải thích **vì sao**, không nhắc lại **làm gì**.
- Không helper "cho chắc", không lớp trừu tượng khi mới có một nơi dùng.
- Mã và comment viết tiếng Anh; tài liệu và spec viết tiếng Việt.

## 7. Bảo mật tối thiểu

- Private key của provider và checker chỉ đọc từ env trong `config.ts`. Không log, không trả về, không đưa vào thông báo lỗi.
- Khoá provider (nhận tiền, gửi tx) và khoá checker (ký verdict) là **hai khoá khác nhau**, kể cả khi cùng chạy trong một server.
- Giới hạn tần suất theo IP cho `/ask` (`express-rate-limit`).
- Giới hạn độ dài câu hỏi trong schema zod.

## 8. Test

- **Vitest** + `supertest`. Test nằm trong `apps/api/test/`, cây phản chiếu `src/`.
- LLM và chain được **giả lập ở ranh giới** (`answer.service`, `payment.chain`) trong test thường. Luồng thật trên Fuji chạy bằng một script E2E riêng, không chạy trong `npm test`.
- Đặt tên theo hành vi, kèm ID tiêu chí: `"AP-03-AC02 wrong citation refunds the payer"`.
- Mỗi tiêu chí chấp nhận `AP-xx-ACnn` có ít nhất một test (Vitest hoặc Foundry).

## 9. Git

Nhánh `feat/…`, `fix/…`, `docs/…`. Commit dạng `type(scope): mô tả` (tiếng Anh). Một PR một slice quan sát được. Agent không tự merge.
