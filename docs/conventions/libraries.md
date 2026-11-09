# Thư viện dự kiến — AskPay

**Nguyên tắc** (giữ từ Fablewelf): ít thư viện nhất có thể; mỗi thư viện gắn với một slice dùng nó thật. Phiên bản khoá chính xác lúc cài, không chốt ở đây.

## Dùng chung

| Việc | Chọn | Ghi chú |
|---|---|---|
| Runtime | Node 24 LTS, TypeScript strict, `tsx` khi dev | Giống Fablewelf |
| Monorepo | npm workspaces: `apps/*`, `packages/*` | `contracts/` nằm ngoài |
| Validation, hợp đồng API | `zod` trong `packages/shared` | Backend validate, frontend import kiểu |
| Chain client | `viem` | Dùng cho cả server, web (qua wagmi) và script |
| x402 | `@x402/core`, `@x402/evm` (v2) | Dùng kiểu dữ liệu và helper ký/kiểm EIP-3009; scheme escrow tự viết (xem PLAN §3.2). Không dùng gói `x402` v1 đã ngừng phát triển |
| Merkle tree | `@openzeppelin/merkle-tree` | Khớp `MerkleProof` của OpenZeppelin ở on-chain |
| Lint/format | ESLint + typescript-eslint + Prettier; `forge fmt` cho Solidity | Cấu hình Prettier giống Fablewelf |
| Test | Vitest (+ `supertest`, Testing Library); Foundry | |

## Backend (`apps/api`)

| Việc | Chọn | Ghi chú |
|---|---|---|
| HTTP | `express` 5 | Bắt lỗi async sẵn |
| Log | `pino` | |
| Env | `node --env-file` + `config.ts` (zod) | Không `dotenv` |
| Lưu lịch sử | `node:sqlite` (có sẵn trong Node 24) | Nếu gặp hạn chế thì chuyển `better-sqlite3`; quyết ở bước design |
| Giới hạn tần suất | `express-rate-limit` | |
| LLM | SDK của nhà cung cấp được chọn | **Quyết định mở** trong spec |
| Tìm kiếm | Tự viết BM25 đơn giản + embedding qua API (tính trước, lưu JSON) | Corpus nhỏ (~220 Điều), không cần vector DB. Quyết ở bước design |

## Frontend (`apps/web`)

| Việc | Chọn | Ghi chú |
|---|---|---|
| Framework | Next.js App Router + React 19 | Rewrite `/api` sang `apps/api` |
| Ví | `wagmi` + `viem`, connector injected (Core, MetaMask) | Không thêm bộ UI ví lớn nếu chưa cần |
| Server state | `@tanstack/react-query` | wagmi vốn đã cần |
| Style | Tailwind CSS 4, `clsx`, `tailwind-merge` | |
| Icon | `lucide-react` | |
| Gọi API | `fetch` gói trong một client ở `lib/api.ts` | Bỏ axios cho bớt một thư viện |

## Smart contract (`contracts/`)

| Việc | Chọn |
|---|---|
| Toolchain | Foundry (`forge`, `cast`, `anvil`) |
| Thư viện | `forge-std`, `openzeppelin-contracts` 5.x |

## Không mang theo từ Fablewelf

Prisma, PostgreSQL, Docker Compose, argon2, `jose`, `cookie-parser`, `nodemailer`/Mailpit, `axios`, `react-hook-form`, `@dnd-kit`, `react-markdown`, Playwright (không bắt buộc trong MVP), i18n hai ngôn ngữ.

## Quy tắc thêm thư viện

1. Có tiêu chí chấp nhận hoặc mục spec cần nó; ghi trong PR.
2. Kiểm tra còn bảo trì, license, kích thước; xem có cách làm bằng thư viện chuẩn hoặc thư viện đã có không.
3. Khoá phiên bản chính xác; xem lại lockfile.
4. Không thêm thư viện để dùng "sau này".
