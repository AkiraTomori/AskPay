# 🎬 Demo Runbook (3 phút)

> Nguyên tắc: **demo không được hỏng**. Dùng cho video nộp bài (20/11) và Demo Day (30/11, Greenwich Vietnam, HCMC). Kịch bản gốc ở [spec §7](../spec/askpay-v1.md#7-kịch-bản-demo-23-phút-dùng-cho-video-và-demo-day). Thiết kế độ tin cậy ở [system-design §9](../architecture/system-design.md#9-triển-khai-và-độ-tin-cậy-khi-demo).

## 1. Trước giờ thi (T-60 → T-10 phút)

- [ ] `GET /api/health`: `ok`, `lowBalance: false` (ví provider ≥ 1 AVAX)
- [ ] `GET /api/corpus`: `rootMatches: true`
- [ ] Ví demo có ≥ 0,5 USDC Fuji (đủ 10 câu) và AVAX trả gas cho `claimRefund`
- [ ] Ví demo đang ở mạng **Avalanche Fuji**, đã kết nối web
- [ ] Đã chạy thử 5 câu ở §2; kết quả như kỳ vọng
- [ ] `DEMO_FAKE_CITATION=true` trên instance demo (chỉ hoạt động với tiền tố `#demo-fake`)
- [ ] LLM còn quota; thử 1 câu xong trong < 20 giây
- [ ] Mở sẵn các tab: trang chủ, `/dashboard`, `/verify`, Snowtrace (trang contract)
- [ ] Có sẵn link của một câu `PAID` và một câu `REFUNDED` từ lần chạy thử (phòng khi mạng chậm)
- [ ] Hotspot điện thoại làm mạng dự phòng; laptop có bản API chạy local làm dự phòng

## 2. Kịch bản

| Phút | Thao tác | Màn hình | Lời nói |
|---|---|---|---|
| **0:00** · Vấn đề | Slide 1 | — | "Hỏi AI về luật lao động thì nó hay bịa số Điều. Người dùng không có cách kiểm tra, và vẫn phải trả tiền." |
| **0:20** · Hỏi | Gõ: *"Thời gian thử việc tối đa với công việc cần bằng cao đẳng là bao lâu?"* → Hỏi | Báo giá **0,05 USDC (~1.300đ)**; ví hỏi ký | "Trả theo từng câu, qua x402. Tiền chưa đi đâu cả, chỉ là chữ ký." |
| **0:40** · Chờ | Ký | Timeline: Đã giữ tiền → Đang trả lời → Đang kiểm tra → Đang chốt | "Tiền đang nằm trong smart contract escrow, không nằm trong ví của chúng tôi." |
| **1:00** · Paid | — | Câu trả lời trích **Điều 25 Khoản 2**; thẻ trích dẫn có ✓; badge **PAID**; bấm link Snowtrace | "Contract tự kiểm Merkle proof: Khoản này có thật trong Bộ luật Lao động đã đăng ký. Contract cũng kiểm chữ ký của bộ kiểm tra. Chữ ký đó là kết luận của bộ kiểm tra rằng đoạn trích đúng nguyên văn và liên quan. Đạt thì mới trả tiền." |
| **1:30** · Ngoài phạm vi | Hỏi: *"Nồng độ cồn bao nhiêu thì bị phạt khi lái xe máy?"* | "Không tìm thấy căn cứ…"; badge **ĐÃ HOÀN TIỀN** · `NO_CITATION` | "Không có căn cứ thì không mất tiền." |
| **1:50** · Giả lập server gian lận | Hỏi: *"#demo-fake Làm thêm giờ tối đa bao nhiêu giờ một năm?"* | Badge **ĐÃ HOÀN TIỀN** · `INVALID_CITATION`; link tx hoàn tiền | "Đây là giả lập: tôi cố tình cho server gian lận, gửi một Khoản có nội dung khác bản luật đã đăng ký. Merkle proof không khớp, nên contract tự hoàn tiền." |
| **2:20** · Minh bạch | Mở `/dashboard` rồi `/verify` | Tỉ lệ hoàn tiền, kết quả eval; root trong repo = root on-chain | "Ai cũng tự kiểm được: corpus, Merkle root, contract đều công khai." |
| **2:45** · Kết | Slide cuối | Roadmap | "Trích dẫn không qua kiểm tra thì hoàn tiền, và chính smart contract trả tiền lại cho bạn." |

Nếu còn thời gian: tắt server, chờ quá hạn, bấm **"Nhận lại tiền"** từ ví (P5). Nên quay sẵn đoạn này vì phải chờ 10 phút.

## 3. Câu nói về Avalanche (25% điểm tích hợp)

- **Finality khoảng 1–2 giây:** deposit và settle mỗi lệnh chỉ thêm vài giây vào thời gian trả lời. Người dùng không phải chờ nhiều block.
- **Phí gas rất thấp:** micropayment 0,05 USDC mới có lý. Trên chain phí cao, riêng phí đã lớn hơn giá câu hỏi.
- **USDC gốc của Circle và chuẩn EIP-3009 trên Fuji:** chữ ký x402 dùng thẳng với token. *(Nếu POC-1 không đạt thì nói: dùng token demo có EIP-3009, và lên mainnet thì thay bằng USDC thật.)*
- **x402 trên Avalanche:** hệ sinh thái đã có starter kit và facilitator. AskPay đóng góp thêm một scheme `escrow` có hoàn tiền.
- **Mọi tx có link Snowtrace;** contract đã verify.
- **Roadmap L1:** một L1 riêng cho "luật on-chain", nơi nhiều provider và checker cùng đăng ký root.

## 4. Nếu có sự cố trên sân khấu

| Sự cố | Cách xử lý |
|---|---|
| LLM chậm, câu bị `ANSWER_FAILED` | Nói luôn: "Hệ thống không trả lời được nên tự hoàn tiền." Đây là tính năng, không phải lỗi |
| RPC chậm | Chờ; nếu treo thì mở link Snowtrace của lần chạy thử đã chuẩn bị |
| Ví không hiện hộp ký | Kiểm mạng Fuji; tải lại trang; dùng ví dự phòng đã kết nối sẵn |
| Server API sập | Chuyển sang demo "Nhận lại tiền" (không cần server) và mở trang câu hỏi đã chuẩn bị |
| Mất mạng hội trường | Hotspot điện thoại; tệ nhất thì chiếu video đã quay |
