# 📚 AskPay — Docs

AI trả lời câu hỏi về Bộ luật Lao động 2019, trả tiền theo từng câu qua x402 trên Avalanche Fuji. **Trích sai hoặc không trích thì smart contract tự hoàn tiền.** Hackathon Team1 Vietnam UniHack 2026 · làm một mình · nộp trước 21/11.

Docs viết bằng tiếng Việt; định danh kỹ thuật giữ tiếng Anh.

## Đọc theo thứ tự

| # | File | Nội dung | Khi nào đọc |
|---|---|---|---|
| 0 | [`onboarding/concepts.md`](./onboarding/concepts.md) | **Nhập môn:** 10 cụm khái niệm (blockchain → x402 → EIP-3009 → escrow → Merkle → RAG → checker), hai câu chuyện đầu-cuối, từ điển A–Z | Trước mọi file khác |
| 1 | [`product/pitch.md`](./product/pitch.md) | AskPay là gì, tiêu chí chấm và cách đạt, ví dụ Input→Output, 12 câu FAQ giám khảo | Chuẩn bị pitch, slide |
| 2 | [`spec/askpay-v1.md`](./spec/askpay-v1.md) | **Nguồn sự thật về hành vi.** Tính năng AP-01…AP-10, tiêu chí chấp nhận, quyết định mở Q-01…Q-08, kịch bản demo | Trước khi viết bất kỳ code nào |
| 3 | [`architecture/system-design.md`](./architecture/system-design.md) | **Nguồn sự thật về kiến trúc.** Nguyên tắc P1–P5, quyết định T-01…T-12, luồng x402 escrow, pipeline trả lời–kiểm tra, Merkle, data model, mối đe doạ | Trước khi viết bất kỳ code nào |
| 4 | [`architecture/contracts.md`](./architecture/contracts.md) | Spec Solidity `AskPayEscrow`: storage, hàm, thứ tự kiểm, event, error → câu tiếng Việt, test, deploy | Viết contract; dùng ABI |
| 5 | [`architecture/api.md`](./architecture/api.md) | 6 endpoint, header x402, ví dụ request/response, mã lỗi | Viết `apps/api` hoặc gọi API từ web |
| 6 | [`architecture/codebase.md`](./architecture/codebase.md) | Cây thư mục, ranh giới module, luồng phụ thuộc, test theo tầng | Khi tạo file hoặc module mới |
| 7 | [`conventions/`](./conventions/README.md) | Cách viết code backend, frontend, Solidity; thư viện | Mỗi lần viết code |
| 8 | [`product/ui-pages.md`](./product/ui-pages.md) | 4 trang, component, trạng thái, ma trận trang ↔ API ↔ chain | Viết `apps/web` |
| 9 | [`product/design-system.md`](./product/design-system.md) | **Bắt buộc cho mọi UI.** Phong cách "Công Báo": token, component, pattern, điều cấm | Mọi thay đổi trong `apps/web` |
| 10 | [`runbook/plan.md`](./runbook/plan.md) + [`tasks.csv`](./runbook/tasks.csv) | Mục tiêu, phạm vi, lộ trình theo ngày, quyền của agent, cắt việc, rủi ro, checklist nộp | Đầu mỗi ngày |
| 11 | [`runbook/setup-and-bringup.md`](./runbook/setup-and-bringup.md) | Ví, env, thứ tự bring-up, kiểm tra nhanh, lỗi thường gặp | Dựng môi trường |
| 12 | [`research/poc-results.md`](./research/poc-results.md) | POC-1…POC-4 và kết quả | Trước khi chốt phần có rủi ro |
| 13 | [`runbook/demo.md`](./runbook/demo.md) | Checklist trước giờ thi, kịch bản 3 phút, câu nói về Avalanche, xử lý sự cố | Quay video, Demo Day |

## Khi các file lệch nhau

Thứ tự ưu tiên:

1. `spec/askpay-v1.md` cho **hành vi**.
2. `architecture/system-design.md` cho **kiến trúc**.
3. `architecture/contracts.md` cho **chữ ký hàm, event, error**.
4. `architecture/api.md` cho **endpoint**. Riêng hình dạng chính xác của request/response thì schema zod trong `packages/shared` thắng.
5. `architecture/codebase.md` và `conventions/`.
6. `product/ui-pages.md` và `product/design-system.md`.
7. `product/pitch.md` và `onboarding/concepts.md`. Đây là bản đơn giản hoá, **không dùng làm spec**.

Phát hiện lệch thì **dừng và báo owner** ([AGENTS.md](../AGENTS.md)), rồi sửa tài liệu trước khi sửa code. Nguyên tắc P1–P5 ở `system-design.md` §1 chỉ được đổi khi owner đồng ý.

## Trạng thái

Giai đoạn **cài đặt** (15/11/2026): đã có mã cho contract (đã deploy Fuji), `packages/shared`, `packages/corpus`, `apps/api` (A1–A6) và `apps/web` (W1–W3); W4 đang làm, W5 và phần còn lại ở [`runbook/tasks.csv`](./runbook/tasks.csv). Spec, kiến trúc và convention **đang áp dụng**: owner đã chốt Q-01…Q-13 (Q-08: làm G1 sau E1 và O1, chốt 20/11) và duyệt từng slice. Thiết kế chi tiết từng slice web ở [`design/`](./design/). Khi code xong từng phần, cập nhật lệnh trong `runbook/` cho khớp thực tế.
