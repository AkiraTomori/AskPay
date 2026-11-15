# 🔧 Setup & Bring-up

> Các lệnh dưới đây là **đích đến**. Chúng sẽ chạy được dần theo [`tasks.csv`](./tasks.csv). Khi code thay đổi, cập nhật file này cho khớp thực tế.

## 1. Yêu cầu

| Công cụ | Phiên bản | Ghi chú |
|---|---|---|
| Node.js | 24 LTS | `nvm use` (file `.nvmrc`) |
| npm | đi kèm Node | workspaces |
| Foundry | bản mới nhất (`foundryup`) | `forge`, `cast`, `anvil` |
| Ví trình duyệt | Core hoặc MetaMask | Thêm mạng Avalanche Fuji |
| Git | — | `forge install` dùng submodule |

Không cần Docker. SQLite dùng `node:sqlite` có sẵn trong Node 24.

## 2. Ví và tài sản testnet

Tạo **ba ví riêng cho hackathon**. Không dùng ví chứa tài sản thật.

| Ví | Dùng để | Cần |
|---|---|---|
| `askpay-owner` | Deploy, `setLawRoot` | ~1 AVAX Fuji |
| `askpay-provider` | Server gửi `deposit` và `settle`, nhận tiền | ≥ 2 AVAX Fuji |
| `askpay-checker` | Chỉ ký verdict | Không cần AVAX |
| Ví demo (người hỏi) | Hỏi trên web | ~0,5 AVAX + vài USDC Fuji |

- **Thực tế deploy 14/11/2026 (K3):** do thiếu AVAX ở ví riêng, owner và provider dùng chung một ví `0x07197328B09cc40D6ecE53e84413495DA20FF008` (keystore `askpay-main`); checker là `0x5c6EB80078D8492AeBd65114f7b71aD1F7536AA8`. Hợp đồng cho phép owner trùng provider. Muốn tách lại thì owner gọi `setProvider` (một giao dịch).
- Nhập khoá vào keystore của Foundry: `cast wallet import askpay-owner --interactive`. Khoá không xuất hiện trên dòng lệnh.
- AVAX Fuji: faucet của Core (`core.app/tools/testnet-faucet`) hoặc faucet trên team1vn.xyz.
- USDC Fuji: `faucet.circle.com`, chọn Avalanche Fuji. Dán địa chỉ **ví người hỏi** (tài khoản Core đang kết nối với web), không dán địa chỉ escrow, provider hay checker: USDC gửi nhầm vào escrow không lấy lại được (contract không có hàm rút).

## 3. Biến môi trường

`apps/api/.env` (đã gitignore; mẫu ở `.env.example`):

| Biến | Ví dụ | Ghi chú |
|---|---|---|
| `CHAIN_ID` | `43113` | `config.ts` từ chối giá trị khác |
| `RPC_URL` | `https://avalanche-fuji-c-chain-rpc.publicnode.com` | RPC công cộng của Avalanche (`https://api.avax-test.network/ext/bc/C/rpc`) có thể rate limit theo IP (Cloudflare 1015, HTTP 429). Đã gặp ngày 15/11/2026: API nhận kết quả `settle` chậm khoảng 1 phút dù chain đã xong sau 7 giây; đổi sang publicnode thì nhanh hơn (chưa đo lại). Dùng publicnode hoặc RPC có khoá API khi chạy thật |
| `RPC_URL_FALLBACK` | RPC thứ hai | Tuỳ chọn |
| `PROVIDER_PRIVATE_KEY` | — | **Chỉ ở đây**, không bao giờ log |
| `CHECKER_PRIVATE_KEY` | — | Phải khác provider: `config.ts` từ chối nếu hai khoá cho cùng một địa chỉ (T-04). Địa chỉ của nó phải bằng `checker` trong `contracts/deployments/fuji.json`, nếu không `settle` revert `InvalidCheckerSignature` |
| `LLM_PROVIDER` | `groq` | `groq` hoặc `openrouter` (Q-01: Groq) |
| `LLM_API_KEY` | — | **Chỉ ở đây**, không bao giờ log. **Bắt buộc** cùng `LLM_MODEL`: thiếu thì server không chạy, vì mọi câu đã trả tiền sẽ bị hoàn |
| `LLM_MODEL` | `qwen/qwen3.8-27b` | Model đã chốt ở Q-01 |
| `LLM_JSON_MODE` | `true` | Đặt `false` nếu model từ chối `response_format` |
| `PRICE_UNITS` | `50000` | 0,05 USDC (Q-02) |
| `QUOTE_TTL_SECONDS` | `300` | |
| `DATABASE_PATH` | `./data/askpay.sqlite` | Khi deploy: trỏ vào thư mục mount của ổ đĩa lưu bền (Render disk hoặc volume của Railway), ví dụ `/var/data/askpay.sqlite`. Không để trên ổ đĩa tạm (system-design T-14). |
| `DEMO_FAKE_CITATION` | `false` | Chỉ bật khi quay demo bước 4 |
| `LOG_RANGE_BLOCKS` | `100` | Số block tối đa cho một lần `eth_getLogs`. RPC công khai Fuji chỉ cho 100; RPC tốt hơn thì nâng lên |
| `SCAN_LOOKBACK_BLOCKS` | `43200` | Khi chưa có checkpoint (DB mới hoặc mất DB): quét lùi bao nhiêu block tìm deposit lạc (~1 block mỗi 2 giây, nên 43200 là 24 giờ). Mặc định giữ 24 giờ (owner chốt 14/11/2026, xem system-design §5.6 F). Lần chạy đầu của DB demo đặt giá trị này đủ lớn để chạm `deploymentBlock` (61046807) và chạy sớm (owner chốt 15/11/2026) |
| `CORPUS_PATH` | file trong `packages/corpus/data` | Tuỳ chọn: file corpus khác |
| `PORT` | `4000` | |

Không có biến env cho `settleCutoff` (60 giây) và `pipelineBudget` (120 giây). Đây là hằng số cố định trong `config.ts`, để môi trường deploy không lệch spec (system-design §5.6 B).

`apps/web/.env.local`: `API_ORIGIN=http://localhost:4000` (cho rewrite), `NEXT_PUBLIC_CHAIN_ID=43113`.

- `NEXT_PUBLIC_RPC_URL` (tuỳ chọn): RPC mà trình duyệt dùng để đọc số dư USDC. Không đặt thì web dùng publicnode (`https://avalanche-fuji-c-chain-rpc.publicnode.com`, mặc định trong `apps/web/src/lib/constants.ts`, đổi từ RPC công cộng của Avalanche vì RPC đó có thể rate limit như `RPC_URL` ở trên). Muốn dùng RPC khác (ví dụ có khoá API), đặt `NEXT_PUBLIC_RPC_URL` trong `.env.local`, không có dấu chấm cuối. Biến này nằm ở `apps/web/.env.local`, không phải `apps/api/.env`, và phải chạy lại `npm run dev:web` sau khi đổi.
- `API_ORIGIN` được đọc lúc build: `next build` cố định đích của rewrite, nên đổi `API_ORIGIN` thì phải build lại trước khi `next start`.

Địa chỉ contract **không** đặt trong env: lấy từ `contracts/deployments/fuji.json` qua `packages/shared`.

## 4. Thứ tự bring-up (lần đầu)

```bash
nvm use && npm install
cd contracts && forge install && forge test && cd ..

# 1. Corpus (cần file luật trong packages/corpus/raw/)
npm run corpus                      # → packages/corpus/data/*.json, root.txt

# 2. Contract (CẦN OWNER DUYỆT: broadcast lên Fuji)
cd contracts
# TOKEN, PROVIDER, CHECKER là địa chỉ công khai (không phải khoá); ANSWER_WINDOW mặc định 600
TOKEN=0x5425890298aed601595a70AB815c96711a31Bc65 PROVIDER=0x… CHECKER=0x… \
  forge script script/Deploy.s.sol --rpc-url fuji --chain fuji --account askpay-owner --broadcast --verify
cd .. && node scripts/record-deployment.mjs && cd contracts   # ghi deployments/fuji.json
forge script script/RegisterLawRoot.s.sol --rpc-url fuji --account askpay-owner --broadcast
cd ..
npm run abi                         # → packages/shared/src/abi, deployments.ts

# 2b. E2E contract trên Fuji (K4, CẦN OWNER DUYỆT: gửi giao dịch)
# Tạo .env.e2e ở thư mục gốc (đã gitignore) bằng editor: PROVIDER_PRIVATE_KEY, CHECKER_PRIVATE_KEY,
# E2E_PAYER_PRIVATE_KEY (ví hackathon có ≥ 0,05 USDC Fuji). Script không in khoá.
npm run e2e:contract                # chạy khô: kiểm điều kiện và mô phỏng, KHÔNG gửi gì
npm run e2e:contract -- --send      # gửi thật: Refunded (NoCitation), Refunded (InvalidCitation), Paid

# 2c. API (A4) + client ký thử. Cần apps/api/.env (xem apps/api/.env.example) và .env.e2e
npm run dev:api                     # :4000, đọc apps/api/.env
npm run ask:client -- "Thử việc tối đa bao lâu?"   # 402 → ký → trả tiền → 202 ANSWERING (CẦN OWNER DUYỆT nếu chạy trên Fuji thật: tiền nằm trong escrow tới khi A5 chốt)

# 3. Chạy
npm run dev                         # api :4000, web :3000
```

## 5. Kiểm tra nhanh sau khi lên

| Kiểm | Kỳ vọng |
|---|---|
| `curl localhost:4000/api/health` | `ok: true`, `lowBalance: false` |
| `curl localhost:4000/api/corpus` | `rootMatches: true`, `dieuCount: 220` |
| `curl -i -X POST localhost:4000/api/ask -H 'content-type: application/json' -d '{"question":"Thử việc tối đa bao lâu?"}'` | `402`, có header `PAYMENT-REQUIRED` |
| Mở `localhost:3000`, kết nối ví, hỏi một câu | Kết thúc ở `PAID` hoặc `REFUNDED`, có link Snowtrace |
| `npm run e2e:fuji` | 3 kịch bản đạt |

## 6. Sự cố thường gặp

| Triệu chứng | Nguyên nhân hay gặp | Cách xử lý |
|---|---|---|
| `deposit` revert `FiatTokenV2: invalid signature` | Domain EIP-712 sai (`name`/`version` của token) | Đọc `name()` và `version()` từ token; xem POC-1 |
| `deposit` revert `authorization is used or canceled` | Dùng lại `qid` hoặc chữ ký | Xin báo giá mới |
| `settle` revert `InvalidCheckerSignature` | Khoá checker trong env khác `checker` on-chain; hoặc `citationsHash` mã hoá lệch giữa TS và Solidity | So `cast call escrow "checker()"`; chạy test fixture leaf và citationsHash |
| Mọi trích dẫn đều `INVALID_CITATION` | Corpus đổi mà chưa đăng ký root mới; chuẩn hoá chữ lệch | `GET /api/corpus` xem `rootMatches`; chạy lại `npm run corpus` |
| Indexer báo lỗi khoảng block | RPC giới hạn `getLogs` | Giảm `INDEXER_BLOCK_RANGE` |
| Ví báo "sai mạng" | Ví đang ở C-Chain mainnet | Nút chuyển mạng trong `NetworkGuard` |
| `nonce too low` khi gửi tx | Hai tiến trình dùng chung ví provider | Chỉ chạy **một** instance API |
