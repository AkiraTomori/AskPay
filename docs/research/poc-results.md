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

### K4 — E2E contract trên Fuji thật (14/11/2026)
- Làm gì: `npm run e2e:contract -- --send` ([scripts/e2e-contract-fuji.mjs](../../scripts/e2e-contract-fuji.mjs)) với `AskPayEscrow` `0x869E95576f6dD6f06118CF733b4F307Ae37ddce0`. Payer `0x195A…38D5` ký `ReceiveWithAuthorization` 0,05 USDC mỗi lần; provider `0x0719…F008` gửi `deposit` và `settle`; checker `0x5c6E…6AA8` ký verdict.
- Kết quả: **Đạt**, 3 luồng, 6 giao dịch, mọi kiểm tra của script PASS. Đọc lại độc lập trên chain: hai câu hỏi `Refunded`, một câu `Paid`, escrow giữ 0, payer 19,95 USDC, provider 0,05 USDC.
- Bằng chứng (Snowscan):

| Luồng | Kết quả | `deposit` | `settle` |
|---|---|---|---|
| refund-no-citation | `Refunded(NoCitation)` | [0xadc8…8139](https://testnet.snowscan.xyz/tx/0xadc8112d240b8333eaf9dbdf122a70a2a5438cd048e0099313ef26b69fd78139) | [0x30e4…a277](https://testnet.snowscan.xyz/tx/0x30e404ad88018d550fb08b02a416101f7d89e7beb9a86508d3ed99145d35a277) |
| refund-invalid-citation | `Refunded(InvalidCitation)` | [0x524e…b015](https://testnet.snowscan.xyz/tx/0x524ef17bd0072707ef6b05b9500133d9cfae3906a4070025f7abe8e85539b015) | [0x7016…842f](https://testnet.snowscan.xyz/tx/0x7016d0cd76c1e79b67613f446d4f16484eeb9c157889eb340b6c8a8cec71842f) |
| paid | `Paid` | [0x0559…2626](https://testnet.snowscan.xyz/tx/0x05592e9421e639f133cbd799b5222cdabd95b68a4dfc749b1dc355d0db902626) | [0x45e9…0df91](https://testnet.snowscan.xyz/tx/0x45e927a005230fb38b0ad16e3b4e37ee73fd5a4350545777dba4b14638df0f91) |

- Chưa kiểm: luồng `claimRefund` sau hạn 600 giây và `refundByProvider` trên Fuji thật (đã có test forge, chưa có tx thật); `settle` với nhiều trích dẫn.
- Quyết định kéo theo: mốc E2E 12/11 của plan đạt (1 Paid + 1 Refunded trên Snowtrace).

