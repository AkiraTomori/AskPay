# Kết quả POC

> POC là thí nghiệm nhỏ để chốt một phần rủi ro **trước khi** viết code thật. Mỗi POC có câu hỏi rõ ràng, tiêu chí đạt, và kết luận ghi lại ở đây. Code POC (nếu có) để ở `poc/<mã>/`, không đưa vào `apps/` hay `packages/`.

| Mã | Câu hỏi | Tiêu chí đạt | Ảnh hưởng nếu không đạt | Hạn | Kết quả |
|---|---|---|---|---|---|
| **POC-1** | USDC testnet của Circle trên Fuji có `receiveWithAuthorization` không? Domain EIP-712 (`name`, `version`) là gì? | Trên anvil fork Fuji: một contract tạm gọi `receiveWithAuthorization` với chữ ký viem thì nhận được tiền | T-12 chuyển sang `MockUSDC`; sửa câu nói về Avalanche trong demo | 10/11 | ✅ Đạt (14/11) |
| **POC-2** | Leaf và `citationsHash` mã hoá trong TypeScript có khớp Solidity không? | Fixture JSON sinh từ TS → `forge test` khớp 100% (gồm Khoản 0 và chữ có dấu) | Proof hỏng toàn bộ; phải sửa `leaf.ts` | 11/11 | ⬜ |
| **POC-3** | LLM đã chọn (Q-01) có trả JSON tiếng Việt đúng schema và chỉ trích ID ứng viên không? | ≥ 9/10 câu JSON hợp lệ; 0 câu trích ID ngoài danh sách | Đổi model hoặc nhà cung cấp; thêm bước sửa JSON | 13/11 | ⬜ |
| **POC-4** | BM25 âm tiết có đưa đúng Khoản vào top-8 không? | ≥ 8/10 câu mẫu có Khoản đúng trong top-8 | Thêm embedding (T-05) | 13/11 | ⬜ |

## Ghi kết quả

Khi xong mỗi POC, thêm một mục theo mẫu:

```
### POC-n — <tên> (<ngày>)
- Làm gì: …
- Kết quả: Đạt / Không đạt, kèm số liệu
- Bằng chứng: lệnh đã chạy, tx hash hoặc đường dẫn log
- Quyết định kéo theo: T-xx / Q-xx chốt thành …
```

### POC-1 — USDC Fuji có EIP-3009 (14/11/2026)
- Làm gì: đọc `name()`, `version()`, `DOMAIN_SEPARATOR()`, typehash của USDC Fuji (`0x5425890298aed601595a70AB815c96711a31Bc65`, chỉ đọc, không broadcast). Rồi chạy [`poc/poc-1/run.mjs`](../../poc/poc-1/run.mjs) trên anvil fork Fuji: deploy `AskPayEscrow` thật làm "contract tạm" bằng `script/Deploy.s.sol`, cấp USDC cho ví người trả tạm bằng cách giả danh (impersonate) một ví đang giữ USDC, ký `ReceiveWithAuthorization` bằng viem, provider gọi `deposit`.
- Kết quả: **Đạt.**
  - `name()` = `USD Coin`, `version()` = `2`, `decimals()` = 6, chain id 43113.
  - `DOMAIN_SEPARATOR` tính bằng viem từ `(name, version, 43113, địa chỉ USDC)` khớp giá trị on-chain `0xfe9fa105…d374b3`.
  - `RECEIVE_WITH_AUTHORIZATION_TYPEHASH` on-chain khớp `keccak256("ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)")`.
  - `deposit` 0,05 USDC thành công (gas 142.998): có event `Deposited`, số dư escrow tăng đúng 50.000, số dư người trả giảm đúng 50.000.
  - Đối chứng: cùng chữ ký nhưng domain `version: "1"` bị từ chối (tx revert, không có tiền chuyển).
  - Overload `(v, r, s)` trong `IERC3009` được token thật chấp nhận.
- Bằng chứng: `anvil --fork-url https://api.avax-test.network/ext/bc/C/rpc`, sau đó `forge script script/Deploy.s.sol --unlocked …` và `RPC=http://127.0.0.1:8545 ESCROW=… HOLDER=… node poc/poc-1/run.mjs`. Toàn bộ 7 kiểm tra PASS (kể cả đối chứng). Mọi thứ chỉ chạy trên fork cục bộ, **chưa** có giao dịch nào trên Fuji thật.
- Chưa kiểm: danh sách đen (blacklist) và trạng thái tạm dừng của USDC trên Fuji thật tại thời điểm demo; việc này chỉ lộ ra ở K4 trên Fuji.
- Quyết định kéo theo: T-12 chốt **USDC Fuji**, `MockUSDC` chỉ dùng trong test. Q-03 chốt theo cùng quy tắc (owner đã đặt ngày 14/11/2026). Giữ nguyên câu về USDC gốc trong demo.
