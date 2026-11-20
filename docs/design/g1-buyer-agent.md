# G1 — Buyer agent (AP-10)

> **Trạng thái:** owner đã duyệt (20/11/2026): Q-08 = **Có** và U-35…U-38 theo đề xuất. Ticket G1 ([tasks.csv](../runbook/tasks.csv)), P2, hạn gốc 18/11, ước 3 giờ. Phụ thuộc A5 (đã xong).
> **Điều kiện kèm theo (U-35):** làm G1 **sau** E1 và O1, và chỉ nếu còn thời gian trước hạn nộp 21/11. Q-08 đã ghi vào [spec §6](../spec/askpay-v1.md). Mỗi lượt chạy live vẫn theo U-38 (trần ≤ 0,20 USDC, ngoài giờ quay video).
>
> **Nguồn:** spec AP-10-AC01, AC02; [api.md §3](../architecture/api.md) (402, `PAYMENT-SIGNATURE`, `202`, các mã lỗi); `packages/shared` (`x402.ts`, `api.ts`, `abi/deployments.ts`); `scripts/ask-client.mjs` (đã chạy được một câu); [codebase.md](../architecture/codebase.md) (`apps/agent`, tuỳ chọn). Mức chi tiết: vừa đủ để implement; không đổi hành vi, contract hay API.

## 1. Việc cần làm

- **Ai dùng:** owner khi demo ("agent khác gọi AskPay qua x402", [pitch FAQ 11](../product/pitch.md)); giám khảo xem một đoạn terminal.
- **Kết quả (AP-10-AC01):** `npm run agent -- --budget 0.20 questions.txt` đọc danh sách câu hỏi, với **từng câu** xin báo giá, ký, trả, rồi in kết quả.
- **Trần ngân sách (AP-10-AC02):** khi khoản trả kế tiếp làm tổng vượt trần thì agent **dừng, báo, không ký**, và in những câu chưa hỏi.
- **Không thuộc G1:** gọi song song nhiều câu; tự `claimRefund`; nhiều provider; lưu lịch sử; giao diện; đổi `scripts/ask-client.mjs`; ví do agent tự tạo hay nạp tiền.

## 2. Luồng một câu

```
quote ──► guard ──► budget.reserve ──► ký ──► gửi trả ──► đọc kết quả
 (402)    (sai → dừng,  (vượt trần →   (EIP-3009)  (PAYMENT-    200: xong
          không ký)     dừng, không ký)            SIGNATURE)   202: poll GET /questions/:qid
```

Chạy **tuần tự, một câu một lúc**. Nhờ vậy khoản "đã cam kết" luôn xác định và không có tranh chấp giữa hai câu.

**Guard (trước khi ký).** Agent giữ khoá, nên không tin báo giá một cách mù quáng. Không ký và dừng cả lượt nếu:
- `scheme` ≠ `escrow`, `network` ≠ Fuji, hoặc `x402Version` ≠ 2;
- `payTo` ≠ địa chỉ escrow và `asset` ≠ token trong `fujiDeployment` (`@askpay/shared/abi/deployments`);
- `amount` không phải số nguyên hợp lệ, hoặc `validBefore` đã qua hoặc xa hơn 1 giờ so với giờ máy.

Guard là phần chặn rủi ro thật: nếu `API_URL` trỏ nhầm tới server lạ, agent không ký cho địa chỉ lạ.

## 3. Trần ngân sách

- **Bắt buộc có `--budget`** (USDC, thập phân, tối đa 6 chữ số, ví dụ `0.20`). Không có giá trị mặc định; thiếu hoặc sai định dạng thì thoát, chưa gửi gì. Số tiền luôn là `bigint` đơn vị nhỏ nhất, không qua số thực.
- `reserve(amount)`: nếu `đã cam kết + amount > trần` thì **từ chối** (agent dừng); bằng trần thì vẫn được.
- **"Đã cam kết" tính theo tổng đã ký, không trừ tiền hoàn.** Câu bị hoàn tiền vẫn chiếm trần trong lượt chạy. Đây là mức tiền tối đa có thể nằm ngoài ví tại một thời điểm; đơn giản và an toàn hơn so với tính ròng. (U-36)
- Cam kết được cộng **trước khi gửi** và chỉ hoàn lại khi server trả lời rõ ràng là **chưa có tiền nào đi** (bảng §4).

## 4. Xử lý theo phản hồi

| Phản hồi | Hành vi | Cam kết |
|---|---|---|
| `402` báo giá sai guard | Dừng cả lượt, nêu lý do | không |
| `reserve` từ chối | **Dừng cả lượt**, in tổng đã cam kết, trần, giá câu kế tiếp, và các câu chưa hỏi | không (chưa ký) |
| `200` | In kết quả (`PAID` hoặc `REFUNDED`); hoàn tiền là kết quả đúng, không phải lỗi | giữ |
| `202` | Poll `GET /questions/:qid` mỗi 2 giây, tối đa ~11 phút (`answerWindow` 600 giây + dư); hết hạn thì in `CLAIMABLE`/chưa rõ và **không ký lại** | giữ |
| `409 QUESTION_ALREADY_SETTLED` | Dùng `details` làm kết quả | giữ |
| Lỗi mạng hoặc timeout **sau khi đã gửi** | Coi như có thể đã giữ tiền: poll theo `qid`; **không** xin báo giá mới cho câu này (không trả hai lần, giống AP-03-AC06) | giữ |
| `402 PAYMENT_INVALID`, `400`, `404` | Server báo chưa có tx; bỏ qua câu này (in lý do), sang câu kế | hoàn lại |
| `503 CHAIN_UNAVAILABLE` | Dừng cả lượt (server không nhận được tiền lúc này) | hoàn lại |
| `429 RATE_LIMITED` khi xin báo giá | Chờ rồi thử lại báo giá (chưa ký, an toàn); tối đa vài lần, rồi dừng | không |
| `429 RATE_LIMITED` khi gửi trả (có envelope lỗi của API) | Bộ giới hạn chạy trước khi server đọc khoản trả nên chưa có gì đổi: chờ rồi **gửi lại đúng request đã ký** (cùng chữ ký, không ký lại), tối đa 3 lần. Hết lần thì **dừng cả lượt**, câu này nằm trong danh sách chưa hỏi. Một `429` không có envelope (proxy) không được tin: poll theo `qid`, giữ cam kết | hoàn lại khi hết lần thử; giữ nếu là `429` trần |
| `409 QUESTION_MISMATCH` | Server kiểm trước khi gửi tiền; bỏ qua câu này, in lý do | hoàn lại |

Mã thoát: `0` hoàn tất cả danh sách; `2` dừng vì trần; `1` dừng vì lỗi hoặc guard.

## 5. Đầu vào, đầu ra, bí mật

- **Đầu vào:** `questions.txt` mỗi dòng một câu (bỏ dòng trống và dòng bắt đầu bằng `#`); hoặc truyền câu trực tiếp làm tham số. Mỗi câu phải qua `askRequestSchema` của `packages/shared` (≤ 500 ký tự) trước khi gửi; câu hỏng bị bỏ qua và báo.
- **Khoá:** chỉ đọc từ biến môi trường trong file `.env.*` đã gitignore, nạp bằng `--env-file`; **không bao giờ** nhận qua tham số dòng lệnh, không in, không ghi log. Chỉ in địa chỉ ví. Đề xuất dùng lại `E2E_PAYER_PRIVATE_KEY` trong `.env.e2e` (cùng ví đã có tiền cho `ask:client`) (U-37).
- **API:** `API_URL` (mặc định `http://localhost:4000`).
- **Đầu ra, mỗi câu một khối:** câu hỏi, trạng thái (`PAID`/`REFUNDED` kèm lý do), câu trả lời, các trích dẫn dạng `Đ25 K2`, link tx trên Snowtrace. Cuối: số đã cam kết / trần, số câu Paid, Refunded, chưa hỏi. Không in JSON thô.

## 6. Cấu trúc và ranh giới

`apps/agent/` (workspace mới, theo [codebase.md](../architecture/codebase.md)). Chỉ import `@askpay/shared` và `viem`; **không import `apps/api` hay `apps/web`**. Không gọi chain trực tiếp: agent chỉ **ký** một authorization, server mới gửi tx (như `ask-client.mjs`).

| File | Vai trò |
|---|---|
| `src/budget.ts` | Thuần: `parseBudget("0.20")`, `createBudget(cap)` → `reserve`, `release`, `committed`, `remaining` |
| `src/guard.ts` | Thuần: `checkQuote(requirement, deployment, nowSeconds)` → ok hoặc lý do |
| `src/client.ts` | `askAndPay(question)` với `fetch` và `signer` **truyền vào**; trả một kết quả có kiểu (bảng §4) |
| `src/cli.ts` | Đọc tham số và env, lặp danh sách, in kết quả, mã thoát |
| `test/*.test.ts` | Theo AP-10-ACnn (§7) |

Việc phải sửa ngoài `apps/agent/`:
- `package.json` gốc: script `agent` (`tsc --build && node --env-file=.env.e2e apps/agent/dist/cli.js`) và thêm `tsc -p apps/agent/tsconfig.test.json` vào `typecheck` nếu có.
- `tsconfig.json` gốc: thêm reference tới `apps/agent`.
- `vitest.config.ts`: thêm `apps/agent` vào `include` của project `node`. **Nếu thiếu bước này, test không chạy và `npm run verify` vẫn xanh.**
- `codebase.md`: `apps/agent` chuyển từ "tuỳ chọn" sang đã có.

## 7. Kiểm chứng

Test chạy trong `npm run verify`, **không cần mạng và không cần ví**: `fetch` giả, signer giả.

| Tiêu chí | Test |
|---|---|
| **AP-10-AC01** | Với `fetch` giả: 402 → ký → 200 `PAID` cho hai câu liên tiếp, kết quả được in; 202 rồi poll tới `REFUNDED`; lỗi mạng sau khi gửi thì **không** xin báo giá thứ hai cho cùng câu |
| **AP-10-AC02** | Trần = 2 giá: câu 1 và 2 được ký, câu 3 **không** gọi `signTypedData` (signer giả đếm số lần gọi = 2), mã thoát `2`, câu 3 nằm trong danh sách chưa hỏi. Trần đúng bằng tổng thì câu cuối vẫn được ký. Trần < 1 giá thì không ký câu nào. |
| Guard | `payTo` hay `asset` khác `fujiDeployment`, `network` sai, `validBefore` quá xa: signer giả **không** được gọi |
| Hoàn cam kết | `402 PAYMENT_INVALID` và `503` trả lại trần; lỗi mạng sau gửi và `200` thì không |
| Budget | `parseBudget`: `0.2`, `0.200000`, `.5`, `1e-2`, `-1`, `0.0000001`, rỗng; không có số thực nào chạm tiền |
| Bí mật | CLI không in khoá khi thiếu hoặc sai khoá; khoá không xuất hiện trong output |

**Chưa kiểm bằng test, chỉ bằng chạy thật:** một lượt trên Fuji với API đang chạy: tiêu tốn USDC testnet của ví người hỏi, AVAX gas của ví provider và hạn mức Groq dùng chung. Mỗi lượt live cần owner đồng ý trước (U-38).

## 8. Rủi ro và lịch

- **Lịch:** hôm nay 20/11, hạn nộp 21/11 (nên nộp trước 20:00). G1 là mục **đầu tiên** của thứ tự cắt việc ([plan §7](../runbook/plan.md)). Owner đã nói chưa cắt việc nên đây chỉ là ghi nhận, không phải đề xuất cắt. Gợi ý thứ tự: E1 và O1 (README, deploy) làm trước, G1 sau; test của G1 không cần mạng nên làm trong khoảng chờ chạy eval.
- **Tiền thật trên testnet:** mỗi câu 0,05 USDC; trần là hàng rào duy nhất. Nên đặt trần nhỏ khi demo (ví dụ 0,20 cho 4 câu).
- **Quota Groq dùng chung với server thật** (như E1): không chạy agent cùng lúc với eval hay lúc quay video.
- **Trùng lặp với `ask-client.mjs`:** hai nơi cùng dựng header x402. Chấp nhận trong G1 (không sửa file cũ); có thể gom lại sau.

## 9. Câu hỏi mở (owner chốt)

| Mã | Câu hỏi | Đề xuất | Chốt |
|---|---|---|---|
| **U-35** | Chốt Q-08: làm AP-10 hay không (ghi bằng `/sdlc:sign-off`). | Làm, **sau** E1 và O1, chỉ nếu còn thời gian trước hạn nộp. Không làm thì bỏ qua tài liệu này; không mất gì khác. | ✅ Owner duyệt 20/11/2026 theo đề xuất. |
| **U-36** | "Đã cam kết" tính theo tổng đã ký (không trừ tiền hoàn). | Có. Phương án khác: tính ròng sau hoàn tiền (cho phép hỏi nhiều hơn, nhưng cần chờ kết quả on-chain và phức tạp hơn). | ✅ Owner duyệt 20/11/2026 theo đề xuất. |
| **U-37** | Dùng lại ví `E2E_PAYER_PRIVATE_KEY` (`.env.e2e`) cho agent. | Có, để khỏi nạp thêm ví. Phương án khác: ví riêng `AGENT_PRIVATE_KEY` trong `.env.agent` (sạch hơn, nhưng thêm bước faucet). | ✅ Owner duyệt 20/11/2026 theo đề xuất. |
| **U-38** | Lượt chạy live đầu tiên trên Fuji: cho phép chạy ngoài giờ quay video, trần ≤ 0,20 USDC. | Cho phép. | ✅ Owner duyệt 20/11/2026 theo đề xuất. |
