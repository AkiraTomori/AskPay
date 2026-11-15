# Coding convention — AskPay

**Trạng thái:** ĐANG ÁP DỤNG (15/11/2026): mã A1–W3 đã được viết và merge theo convention này. Mục tiêu: một người làm 12 ngày vẫn giữ được mã sạch, nhỏ, đọc một module là hiểu trong 5 phút.

- [backend.md](backend.md): `apps/api` (Express + TypeScript)
- [frontend.md](frontend.md): `apps/web` (Next.js)
- [contracts.md](contracts.md): `contracts/` (Solidity + Foundry) và quy tắc on-chain
- [libraries.md](libraries.md): thư viện được dùng và không dùng

## Nguồn gốc: rút từ Fablewelf

Lấy từ `docs/conventions/` của Fablewelf (đã duyệt Pha 1, 05/11/2026), rồi điều chỉnh theo hai điều kiện: hackathon 12 ngày một người, và sản phẩm có phần on-chain.

| | Giữ nguyên từ Fablewelf | Bỏ hoặc nới lỏng | Thêm cho AskPay |
|---|---|---|---|
| Cấu trúc | Monorepo npm workspaces; gom **theo tính năng**; hậu tố lớp `<tính-năng>.<lớp>.ts`; gốc `src/` chỉ có entry, file lẻ vào `shared/`; test trong `test/` phản chiếu `src/` | — | `contracts/` (Foundry) ngoài npm workspaces; `packages/corpus` |
| Hợp đồng API | Zod trong một package dùng chung, backend validate và frontend import kiểu từ cùng nguồn | Tên `packages/contracts` → **`packages/shared`** (tránh nhầm với smart contract) | ABI, địa chỉ deploy, mã hoá leaf Merkle cũng nằm trong `packages/shared` |
| Lỗi | Một `AppError`, một middleware lỗi; envelope `{data}` / `{error}` | Bảng mã lỗi rút gọn | Ngoại lệ có chủ đích: phản hồi **402** theo chuẩn x402, không bọc envelope |
| Dữ liệu | Chỉ đọc biến môi trường trong `config.ts` (zod) | PostgreSQL, Prisma, migration, publicRef/UUID, `If-Match`, idempotency key, xoá mềm | **Chain là nguồn sự thật** cho tiền; SQLite chỉ lưu nội dung câu trả lời và chỉ mục cho dashboard |
| Phong cách | TypeScript strict; hàm export thường; hàm ≤ ~40 dòng, file ≤ ~300 dòng; tên đầy đủ; comment giải thích **vì sao** | — | Số tiền luôn là `bigint` (đơn vị nhỏ nhất của token), không dùng `number` |
| Test | Vitest; đặt tên theo hành vi; mỗi tiêu chí chấp nhận có test ghi ID | PostgreSQL thật, Playwright bắt buộc, i18n | `forge test` (có fuzz) cho contract; ID tiêu chí là `AP-xx-ACnn` |
| Bảo mật | Không log secret | Argon2, JWT, cookie, rate limit theo định danh | Không bao giờ để private key trong mã, log hay chat; Fuji mặc định; mỗi lần broadcast cần owner đồng ý |
| Git | Nhánh `feat/…` `fix/…` `docs/…`; commit `type(scope): mô tả`; một PR một slice; không tự merge | — | — |

Nếu convention mâu thuẫn với spec đã duyệt thì spec thắng, và convention phải sửa trong cùng PR.
