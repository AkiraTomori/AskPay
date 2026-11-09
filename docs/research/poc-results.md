# Kết quả POC

> POC là thí nghiệm nhỏ để chốt một phần rủi ro **trước khi** viết code thật. Mỗi POC có câu hỏi rõ ràng, tiêu chí đạt, và kết luận ghi lại ở đây. Code POC (nếu có) để ở `poc/<mã>/`, không đưa vào `apps/` hay `packages/`.

| Mã | Câu hỏi | Tiêu chí đạt | Ảnh hưởng nếu không đạt | Hạn | Kết quả |
|---|---|---|---|---|---|
| **POC-1** | USDC testnet của Circle trên Fuji có `receiveWithAuthorization` không? Domain EIP-712 (`name`, `version`) là gì? | Trên anvil fork Fuji: một contract tạm gọi `receiveWithAuthorization` với chữ ký viem thì nhận được tiền | T-12 chuyển sang `MockUSDC`; sửa câu nói về Avalanche trong demo | 10/11 | ⬜ |
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
