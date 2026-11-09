# Claude Code — AskPay

Luật dự án nằm ở [AGENTS.md](../AGENTS.md), được nạp qua [CLAUDE.md](../CLAUDE.md). Nguồn skill chuẩn là [plugins/sdlc](../plugins/sdlc/), không có bản sao ở `.claude/skills/`.

## Cài đặt trên mỗi máy

1. Mở Claude Code ở thư mục gốc repo và chọn tin cậy repo khi được hỏi.
2. `settings.json` đã đăng ký marketplace `askpay-sdlc` (trỏ tới nhánh `main` của `AkiraTomori/AskPay`) và bật plugin `sdlc` ở phạm vi project. Cài một lần mỗi máy, **sau khi thư mục `plugins/` đã có trên `main`**:

   `claude plugin install sdlc@askpay-sdlc --scope project`

3. Kiểm tra bằng `claude plugin list`, rồi gọi `/sdlc:spec <phạm vi>`.
4. Muốn thử trước khi merge: chạy `claude --plugin-dir ./plugins/sdlc` ở thư mục gốc repo.

Kiểm tra cấu hình: `claude plugin validate .` và `claude plugin validate ./plugins/sdlc`.

## Skill và agent

- Lệnh chính: `/sdlc:spec`, `/sdlc:design`, `/sdlc:implement`, `/sdlc:verify`, `/sdlc:review`, `/sdlc:pr`, kèm phạm vi cụ thể. Tuỳ chọn: `database`, `frontend-ui-design`, `tdd`, `to-tickets`, `sign-off`.
- `implement`, `pr`, `sign-off`, `to-tickets` chỉ chạy khi gọi tay; không skill nào tự chạy skill kế tiếp.
- `review` chạy trong fork Explore chỉ đọc. Fork này không nạp sẵn AGENTS.md nên tự đọc.
- Agent của plugin: `sdlc:repo_explorer` (chỉ đọc), `sdlc:implementation_worker`, `sdlc:test_engineer`, `sdlc:code_reviewer` (chỉ đọc). Gọi bằng `@agent-sdlc:<tên>`.
- `.agents/skills/` là bản sao cho các host khác (Codex…). Sửa `plugins/sdlc/skills/` trước, rồi đồng bộ 11 file SKILL.md trong cùng thay đổi.

## Quyền và giới hạn

- Hook `PreToolUse` ([guard-actions.cjs](hooks/guard-actions.cjs)):
  - **Từ chối:** force push, và private key dạng thô trên dòng lệnh.
  - **Hỏi trước:** `git push`, broadcast giao dịch on-chain (`forge script --broadcast`, `forge create`, `cast send`), mọi lệnh nhắm mainnet (chain 43114), deploy, merge PR.
- `.env` bị chặn đọc. Khoá ví chỉ nằm trong `.env` hoặc keystore của Foundry, không bao giờ ở mã, log hay chat.
- Đây là lớp phòng thủ bổ sung, không phải ranh giới bảo mật hoàn chỉnh. Một lần đồng ý không có nghĩa là được phép mãi: mỗi giao dịch on-chain, mỗi lần deploy cần xác nhận mạng và mục tiêu cụ thể.
- Hook không tự chạy lint/test sau mỗi lần sửa. Dùng `/sdlc:verify <phạm vi>` và báo đúng những gì đã chạy.
