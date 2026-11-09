# AskPay — Agent Context

**Trạng thái (09/11/2026): CHUẨN BỊ.** Chưa có mã ứng dụng. Kế hoạch ở [docs/PLAN.md](docs/PLAN.md) (đề xuất). Spec ở [docs/spec/](docs/spec/) (đang soạn, **chưa duyệt**). Convention ở [docs/conventions/](docs/conventions/README.md) (đề xuất). Hackathon Team1 Vietnam UniHack: **hạn nộp 23:59 ngày 21/11/2026**, Demo Day 30/11.

## Đọc trước khi làm bất cứ việc gì
1. [docs/PLAN.md](docs/PLAN.md): pitch, phạm vi MVP, kiến trúc, lịch theo ngày.
2. [docs/spec/](docs/spec/): hành vi và tiêu chí chấp nhận `AP-xx-ACnn`. **Spec đã duyệt là quyền cao nhất về hành vi.**
3. [docs/conventions/](docs/conventions/README.md): cách viết code backend, frontend, contract.

## Luật cứng
- **Chỉ viết mã ứng dụng** (`apps/`, `packages/`, `contracts/`) **cho slice đã được owner duyệt.** Spec hoặc design chưa duyệt thì chỉ được sửa tài liệu.
- **Giữ phạm vi MVP** ([PLAN §2](docs/PLAN.md)). Mọi thứ ở cột "Để sau" là roadmap, không làm. Cần cắt việc thì cắt theo thứ tự ở PLAN §4.
- **On-chain:**
  - Chỉ dùng **Avalanche Fuji (43113)**. Mainnet bị cấm nếu owner chưa yêu cầu rõ ràng.
  - Mỗi lần broadcast (deploy, đăng ký root, gửi tx) phải được owner đồng ý trước. Khi xin, nêu rõ mạng, ví ký, contract và hàm sẽ gọi.
  - Private key, seed phrase và API key **không bao giờ** xuất hiện trong mã, commit, log, chat hay dòng lệnh. Chỉ để trong `.env` (đã gitignore) hoặc keystore của Foundry.
- **Nguồn sự thật duy nhất:**
  - Địa chỉ contract: `contracts/deployments/fuji.json`.
  - Hợp đồng API, ABI, mã hoá leaf Merkle: `packages/shared`.
  - Corpus luật: sinh bằng script trong `packages/corpus`, không sửa tay file đầu ra.
  - Không có tài liệu API viết tay.
- Hai tài liệu mâu thuẫn nhau thì **dừng và báo owner**, không tự chọn.
- UI luôn hiện disclaimer: "Thông tin tham khảo, không thay thế tư vấn pháp lý."
- Không commit, push, tạo PR, merge hay deploy nếu owner chưa yêu cầu.

## Quy trình: dùng skill `sdlc`

Skill nằm ở [plugins/sdlc/skills/](plugins/sdlc/skills/); bản sao cho host khác ở `.agents/skills/`. Cách cài plugin xem [.claude/README.md](.claude/README.md). Chưa cài plugin thì gọi skill theo tên.

| Khi nào | Skill | Đầu ra trong repo này |
|---|---|---|
| Làm rõ hành vi, phạm vi, tiêu chí chấp nhận | `/sdlc:spec <phạm vi>` | `docs/spec/` (ID `AP-xx`, `AP-xx-ACnn`, quyết định mở `Q-xx`) |
| Slice có giao diện contract, luồng x402, checker hoặc cấu trúc module mới | `/sdlc:design <slice>` | `docs/design/<slice>.md` |
| Cần cắt spec thành việc nhỏ demo được | `/sdlc:to-tickets <spec>` | Danh sách ticket (chỉ đăng lên tracker khi owner đồng ý) |
| Viết mã cho một slice **đã duyệt** | `/sdlc:implement <slice>` (kèm `/sdlc:tdd` nếu có ranh giới hành vi rõ) | Mã + test trên nhánh `feat/…` |
| Kiểm tra hành vi với bằng chứng thật | `/sdlc:verify <phạm vi>` | Báo cáo: đã chạy gì, đạt, hỏng, chưa kiểm |
| Xem lại thay đổi trước khi mở PR | `/sdlc:review <nhánh hoặc PR>` | Danh sách phát hiện theo mức độ |
| Mở PR | `/sdlc:pr <phạm vi>` | PR nháp hoặc PR, không merge |
| Màn hình hỏi, thanh toán, dashboard | `/sdlc:frontend-ui-design <màn hình>` | Trạng thái UI, a11y |
| Bảng SQLite lịch sử | `/sdlc:database <phạm vi>` | Mô hình dữ liệu tối thiểu |
| Quyết định ảnh hưởng phạm vi, an toàn hoặc chi phí (đổi luật, đổi token, mainnet, đổi LLM) | `/sdlc:sign-off <quyết định>` | Ghi quyết định vào spec |

**Luồng chuẩn cho một slice:**
- Slice lớn: `spec` → `design` → `implement` (+`tdd`) → `verify` → `review` → `pr`.
- Sửa nhỏ: `implement` → `verify` → `pr`.
- Không bắt buộc đi đủ chuỗi. Chọn skill phù hợp với việc đang làm.

**Bàn giao:** Cuối mỗi bước, nêu kết quả, những gì chưa kiểm, rủi ro còn lại, và đưa **đúng một** lệnh `/sdlc:<skill> <phạm vi>` kế tiếp. Không tự chạy lệnh đó.

**Subagent** (`sdlc:repo_explorer`, `implementation_worker`, `test_engineer`, `code_reviewer`): chỉ dùng khi việc đủ lớn.
- Không cho hai agent sửa cùng một file.
- Agent chính giữ quyền về git, PR và broadcast.

**Ưu tiên của hackathon:**
- Chạy được end-to-end trên Fuji sớm (mốc 12/11), rồi mới làm đẹp.
- Trễ lịch quá 1 ngày thì báo owner và đề xuất cắt theo PLAN §4. Không âm thầm giảm chất lượng.

## Định nghĩa xong
- `npm run verify` xanh: format, lint, typecheck, Vitest, `forge fmt --check`, `forge test`. Lệnh này sẽ được thêm ở slice nền móng.
- Mỗi tiêu chí chấp nhận của slice có test ghi ID `AP-xx-ACnn`.
- Báo đúng những gì **thật sự đã chạy**. Tách rõ kiểm tra local, kiểm tra trên Fuji, và phần chưa kiểm.

## Ngôn ngữ
- Tài liệu, spec, mô tả PR: tiếng Việt.
- Mã, comment, commit (`type(scope): description`): tiếng Anh.
