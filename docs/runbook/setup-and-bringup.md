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

- Nhập khoá vào keystore của Foundry: `cast wallet import askpay-owner --interactive`. Khoá không xuất hiện trên dòng lệnh.
- AVAX Fuji: faucet của Core (`core.app/tools/testnet-faucet`) hoặc faucet trên team1vn.xyz.
- USDC Fuji: `faucet.circle.com`, chọn Avalanche Fuji.

## 3. Biến môi trường

`apps/api/.env` (đã gitignore; mẫu ở `.env.example`):

| Biến | Ví dụ | Ghi chú |
|---|---|---|
| `CHAIN_ID` | `43113` | `config.ts` từ chối giá trị khác |
| `RPC_URL` | `https://api.avax-test.network/ext/bc/C/rpc` | |
| `RPC_URL_FALLBACK` | RPC thứ hai | Tuỳ chọn |
| `PROVIDER_PRIVATE_KEY` | — | **Chỉ ở đây**, không bao giờ log |
| `CHECKER_PRIVATE_KEY` | — | Phải khác provider |
| `LLM_PROVIDER` | theo Q-01 | |
| `LLM_API_KEY` | — | |
| `LLM_MODEL` | theo Q-01 | |
| `PRICE_UNITS` | `50000` | 0,05 USDC (Q-02) |
| `QUOTE_TTL_SECONDS` | `300` | |
| `DATABASE_PATH` | `./data/askpay.sqlite` | |
| `DEMO_FAKE_CITATION` | `false` | Chỉ bật khi quay demo bước 4 |
| `PORT` | `4000` | |

`apps/web/.env.local`: `API_ORIGIN=http://localhost:4000` (cho rewrite), `NEXT_PUBLIC_CHAIN_ID=43113`.

Địa chỉ contract **không** đặt trong env: lấy từ `contracts/deployments/fuji.json` qua `packages/shared`.

## 4. Thứ tự bring-up (lần đầu)

```bash
nvm use && npm install
cd contracts && forge install && forge test && cd ..

# 1. Corpus (cần file luật trong packages/corpus/raw/)
npm run corpus                      # → packages/corpus/data/*.json, root.txt

# 2. Contract (CẦN OWNER DUYỆT: broadcast lên Fuji)
cd contracts
forge script script/Deploy.s.sol --rpc-url fuji --account askpay-owner --broadcast --verify
forge script script/RegisterLawRoot.s.sol --rpc-url fuji --account askpay-owner --broadcast
cd ..
npm run abi                         # → packages/shared/src/abi, deployments.ts

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
