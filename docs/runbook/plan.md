# Kế hoạch AskPay (v2)

> Team1 Vietnam UniHack 2026 · Track **Agent economy on x402** · Đề #20 AskPay
> Hạn nộp **23:59 ngày 21/11/2026** · Demo Day 30/11 · Làm một mình · TypeScript + Foundry · Avalanche Fuji
>
> v1 của file này (`docs/PLAN.md`) gộp cả kiến trúc. Từ v2, kiến trúc chuyển sang [`../architecture/system-design.md`](../architecture/system-design.md); file này chỉ còn **mục tiêu, phạm vi, lộ trình, cắt việc, rủi ro**. Task chi tiết ở [`tasks.csv`](./tasks.csv).

## 1. Mục tiêu

- **Nộp đủ hồ sơ trước 21/11:** repo, slide, video demo 2–3 phút. Mọi link mở được ở chế độ ẩn danh.
- **Vào top 10 chung kết.** Muốn vậy cần ghi điểm cao ở "Kỹ thuật" (25) và "Tích hợp Avalanche" (25). Cách đạt từng tiêu chí ở [`../product/pitch.md` §2](../product/pitch.md).
- **Demo không được hỏng:** có kịch bản cố định và phương án khi sự cố ([`demo.md`](./demo.md)).

## 2. Phạm vi MVP (chốt, không mở rộng)

| Có trong MVP | Để sau (chỉ nhắc trong slide "Roadmap") |
|---|---|
| Một văn bản: **Bộ luật Lao động 2019** (45/2019/QH14) | Nhiều luật, nghị định, theo dõi văn bản hết hiệu lực |
| Fuji testnet, USDC testnet (hoặc `MockUSDC`, T-12) | Mainnet, L1 riêng |
| Escrow + Merkle proof + chữ ký checker | Checker độc lập có stake, nhiều checker |
| Web: hỏi, trả tiền, xem kết quả, dashboard, trang tự xác minh | App mobile, tài khoản người dùng |
| Bộ eval khoảng 50 câu, có số liệu | Benchmark lớn |
| *(Nếu đúng lịch tới 18/11)* buyer agent CLI có trần ngân sách | Marketplace nhiều provider |

Hành vi chi tiết: [`../spec/askpay-v1.md`](../spec/askpay-v1.md).

## 3. Hiện trạng (20/11)

- Đã có mã và đã merge: parse và Merkle tree của Bộ luật Lao động (C1, C2), contract `AskPayEscrow` đã deploy Fuji (K1 đến K4), nền móng (F1), `apps/api` từ báo giá đến indexer và `/stats` (A1 đến A6), web shell, hỏi và trang kết quả (W1 đến W3), dashboard (W4), nhận lại tiền và `/verify` (W5), bộ eval (E1), buyer agent (G1, đã chạy live trên Fuji 20/11). Chi tiết và PR ở [tasks.csv](./tasks.csv).
- Chưa đóng: O1 đến O4 (README đã merge ở PR #23; phần còn lại của O1 xem [tasks.csv](./tasks.csv)).
- Quyết định Q-01…Q-13 đã chốt. Q-08 (buyer agent) chốt 20/11/2026: làm G1 **sau** E1 và O1, chỉ nếu còn thời gian trước hạn nộp.

## 4. Quyết định cần chốt trước khi code

| Loại | Ở đâu | Hạn |
|---|---|---|
| Quyết định sản phẩm Q-01…Q-08 | [spec §6](../spec/askpay-v1.md#6-quyết-định-mở-owner-chốt) | 10/11 sáng |
| Quyết định kỹ thuật T-01…T-12 | [system-design §3](../architecture/system-design.md#3-quyết-định-công-nghệ-và-đánh-đổi) | 10/11 sáng |
| Các mục ❓ trong contract | [contracts.md](../architecture/contracts.md) | 11/11 |
| POC-1…POC-4 | [`../research/poc-results.md`](../research/poc-results.md) | 10–13/11 |

## 5. Charter: coding agent được tự quyết tới đâu

| Được tự làm | Phải hỏi owner |
|---|---|
| Sửa tài liệu cho khớp với code đã duyệt | Đổi bất kỳ nguyên tắc P1–P5, Q-xx, T-xx nào |
| Viết code và test trong slice đã duyệt | Thêm thư viện ngoài [libraries.md](../conventions/libraries.md) |
| Chạy `forge test`, `npm run verify`, `anvil` local | **Mọi broadcast lên Fuji**; mọi thao tác mainnet |
| Mở PR khi owner yêu cầu | Merge, deploy web hoặc API |
| Đề xuất cắt việc theo §7 | Thực hiện cắt việc |

## 6. Lộ trình

| Ngày | Việc | Xong khi | Task |
|---|---|---|---|
| **10/11** | Chốt Q/T. Tải luật, parse ra JSON, build Merkle tree. Tạo ví, xin faucet. POC-1 (USDC Fuji có EIP-3009 không). Làm nhiệm vụ Builder Pass | `blld-2019.root.txt` có giá trị; POC-1 có kết luận | D0, C1, C2, P1 |
| **11/11** | `AskPayEscrow` + test Foundry đủ §7 của contracts.md | `forge test` xanh, có invariant | K1, K2 |
| **12/11** | Deploy Fuji, đăng ký root. Script viem chạy deposit → settle | **Mốc E2E:** 1 tx Paid + 1 tx Refunded trên Snowtrace | K3, K4 |
| **13/11** | Scaffold monorepo, `packages/shared`. Retrieval BM25. POC-3 (LLM trả JSON tiếng Việt) | 10 câu mẫu ra top-8 có Khoản đúng | F1, A1, P3 |
| **14/11** | Module answer + checker. `POST /ask` trả 402 và nhận chữ ký | curl → 402 → ký bằng script → 200 | A2, A3, A4 |
| **15/11** | Gắn settle, indexer, SQLite, `GET /questions` | `e2e-fuji.ts` chạy đủ 3 kịch bản | A5, A6 |
| **16/11** | Web: ví, form hỏi, `useAsk`, trang kết quả | Hỏi được từ trình duyệt | W1, W2, W3 |
| **17/11** | Dashboard, trang `/verify`, nút "Nhận lại tiền", xử lý lỗi | Đủ trạng thái trong [ui-pages.md](../product/ui-pages.md) | W4, W5 |
| **18/11** | Bộ eval 50 câu + số liệu. (Buyer agent nếu kịp) | `eval/results/latest.json` | E1, (G1) |
| **19/11** | README. **Đóng băng tính năng**. *Không deploy Vercel/Render (owner chốt 20/11, bản O1-lite; xem [design](../design/o1-deploy-readme.md))* | README đủ checklist §9; mọi link mở được ở ẩn danh | O1 |
| **20/11** | Slide + quay video theo [`demo.md`](./demo.md) | Video 2–3 phút | O2, O3 |
| **21/11** | Dự phòng. Kiểm mọi link. **Nộp trước 20:00** | Đã nộp | O4 |
| 22–29/11 | Nếu vào top 10: tập demo, sửa lỗi nhỏ, chuẩn bị trả lời FAQ | — | — |

## 7. Cắt việc khi trễ (theo thứ tự)

1. Buyer agent (AP-10).
2. Trang `/verify` (chuyển thông tin sang README).
3. Dashboard: chỉ giữ bảng danh sách, bỏ biểu đồ.
4. LLM-judge ở checker (bước C4): chỉ giữ các bước tất định C1–C3.
5. Embedding (vốn đã là tuỳ chọn ở T-05).

**Không bao giờ cắt:** escrow + Merkle proof + chữ ký checker, `claimRefund`, link Snowtrace, disclaimer.

## 8. Rủi ro

| Rủi ro | Dấu hiệu | Xử lý |
|---|---|---|
| USDC Fuji không có `receiveWithAuthorization` hoặc domain khác | POC-1 thất bại | Tự deploy `MockUSDC` có EIP-3009 (T-12); nói rõ trong pitch |
| File luật lỗi định dạng, parse sai | Số Điều ≠ 220 | Lấy từ nguồn khác (bản Word của vbpl.vn); đối chiếu tay 20 Điều đầu |
| LLM bịa số Điều trong câu trả lời | Eval thấy C3 rớt nhiều | Siết prompt; checker C3 đã chặn; hiển thị thay vì giấu |
| RPC Fuji chậm hoặc giới hạn `getLogs` | Indexer lag | Chia nhỏ khoảng block; RPC dự phòng |
| Hết AVAX ví provider | `/health` báo `lowBalance` | Xin faucet sớm; giữ 2 ví dự phòng |
| Trễ lịch quá 1 ngày | Mốc 12/11 không đạt | Cắt theo §7, báo sớm |
| Giám khảo hỏi "server vừa là provider vừa là checker" | — | Trả lời theo [system-design §11](../architecture/system-design.md#11-giới-hạn-đã-biết) và FAQ ở pitch |

## 9. Checklist nộp bài

- [ ] Repo GitHub (nếu private: thêm `tuantqse90` làm collaborator)
- [ ] Slide (Canva hoặc Google Slides), quyền xem công khai
- [ ] Video demo 2–3 phút, quyền xem công khai
- [ ] README: cách chạy, địa chỉ contract trên Fuji, link Snowtrace, kết quả eval
- [ ] Mở thử mọi link ở chế độ ẩn danh trước khi nộp
- [ ] Hoàn thành 5 nhiệm vụ Builder Pass
