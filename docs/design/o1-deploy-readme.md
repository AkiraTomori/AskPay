# O1 — README, chạy local và đóng băng (bản O1-lite, không deploy)

> **Trạng thái:** owner đã duyệt (20/11/2026) **bản O1-lite: không deploy Vercel/Render**. Ticket O1 ([tasks.csv](../runbook/tasks.csv)), P0, hạn gốc 19/11. Phụ thuộc W5 và E1: cả hai đã có trên `main` (W5 #21, E1 #22).
> **Xong khi:** README đủ checklist [plan §9](../runbook/plan.md) và mọi link trong đó mở được ở chế độ ẩn danh; bản nộp được đóng băng bằng tag.
>
> **Vì sao không deploy:** checklist nộp bài (plan §9) không yêu cầu bản chạy công khai; "link public chạy được" chỉ là mục tiêu lộ trình 19/11. Hạn nộp 21/11 nên bỏ Render và Vercel để giảm việc (ước 4 giờ xuống khoảng 1,5 giờ) và rủi ro. Chi phí Render và disk bền (Q-12, T-14) **không còn áp dụng**. Owner xác nhận form nộp bài của ban tổ chức không yêu cầu live URL.
>
> **Nguồn:** [plan §9](../runbook/plan.md); spec §8 (bảng lời khẳng định, Q-10); [demo runbook](../runbook/demo.md); [setup-and-bringup](../runbook/setup-and-bringup.md); `eval/results/latest.json`.
> Không đổi hành vi, contract hay API. **G1** (buyer agent) không thuộc O1: chưa có trên `main`, và Q-08 vốn chỉ là "làm nếu còn thời gian" (owner nghi không kịp). README chỉ nhắc `apps/agent` nếu G1 đã merge trước khi đóng băng.

## 1. Kết quả cần có

- **Giám khảo:** đọc README và thấy ngay: AskPay là gì, contract ở đâu và xem trên Snowtrace, kết quả eval (số, ngày, commit), cách tự kiểm; xem video demo.
- **Owner:** một README đủ để người lạ hiểu và kiểm lại số liệu; một bản đã đóng băng để không ai vô tình làm hỏng bản nộp; bản local chạy ổn cho video và Demo Day.
- **Không thuộc O1:** Vercel, Render, tên miền, CI, Docker; slide (O2), video (O3), Builder Pass và thao tác nộp (O4); sửa code ứng dụng (smoke test lộ lỗi thì dừng và hỏi).

## 2. README

Giữ phần mô tả hiện có (hình luồng và "đọc hình theo số") nhưng sửa lại. README hiện còn các chỗ cũ: "Cấu trúc repo (dự kiến)", "đang cài đặt (15/11)", "W4 đang làm".

| Mục | Nội dung |
|---|---|
| Đầu trang | Một câu mô tả; link **video** và **slide**. Chỉ thêm khi O3 và O2 đã có link mở được; chưa có thì bỏ dòng, không ghi "sắp có". **Không có link "bản chạy thật"** |
| Cách hoạt động | Hình luồng hiện có, câu chữ chỉnh theo quy tắc bên dưới |
| **Contract trên Fuji** | Địa chỉ `0x869e…` (chép từ `contracts/deployments/fuji.json`, không gõ tay), link Snowtrace, tx deploy, Merkle root. Chỉ ghi "đã verify" nếu **đã mở trang Snowtrace và thấy mã nguồn đã verify** |
| **Câu hỏi đã chạy thật** | Vài link Snowtrace tới tx `Paid` và `Refunded` có thật, lấy từ các lần chạy thử đã có (không cần broadcast mới) |
| **Kết quả eval** | Ba số, ngày chạy, commit, mẫu số: **chép từ `eval/results/latest.json`**, không tự tính. Ghi rõ: một lần chạy, 50 câu, model Groq `qwen/qwen3.8-27b`; câu gõ không dấu chưa được hỗ trợ (giới hạn của retrieval, đã quyết không đưa vào bộ eval) |
| **Cách chạy** | Yêu cầu Node 24; `npm ci`; `npm run verify`; `npm run eval`; chạy web và API local. **Nói thẳng điều kiện:** chạy trọn luồng hỏi và trả tiền cần ví Fuji, khoá provider/checker và khoá LLM của người chạy, nên giám khảo tự kiểm được `verify`, `forge test`, root Merkle và dữ liệu on-chain mà không cần khoá. Chi tiết trỏ tới `setup-and-bringup.md`. **Không đưa khoá vào ví dụ** |
| Cấu trúc repo | Bảng thư mục hiện có, bỏ chữ "dự kiến". Chỉ nhắc `apps/agent` nếu đã có trên `main` |
| Giới hạn đã biết | Tóm [system-design §11](../architecture/system-design.md) |
| Đọc tiếp | Giữ |

**Quy tắc câu chữ.** README phải khớp [spec §8 (Q-10)](../spec/askpay-v1.md); câu nào nói rộng hơn bảng thì sửa. **Không** viết:
- "blockchain/contract kiểm đúng nguyên văn đoạn trích" hay "phát hiện AI trích bịa". Contract kiểm **Khoản có trong luật đã đăng ký (Merkle proof)** và **chữ ký của checker**. Đoạn trích có nằm trong nguyên văn và Khoản có liên quan hay không là do **checker** kiểm, off-chain.
- "checker độc lập": ở v1 checker dùng khoá riêng nhưng do chính AskPay vận hành.
- "ai cũng kiểm được đoạn trích ngay trên `/verify`": `/verify` chỉ so Merkle root.

Dòng thứ ba của README hiện tại ("Smart contract tự kiểm trích dẫn bằng Merkle proof…") và phần "Vì sao tin được" cần soát lại theo bảng trên. Câu thông điệp theo Q-10: **"Trích dẫn không qua kiểm tra thì hoàn tiền, và chính smart contract trả tiền lại cho bạn."** Giữ disclaimer ở cuối README.

## 3. Repo public và quét bí mật (U-42)

Repo hiện **private** (`AkiraTomori/AskPay`). Owner chọn **public khi nộp**, nên trước khi đổi:
1. Quét **toàn bộ lịch sử git**, không chỉ cây hiện tại: chuỗi dạng khoá riêng (64 hex sau `0x`/`PRIVATE_KEY=`), `.env`, API key (`gsk_`, `sk-`…), seed phrase, file keystore. Chỉ đọc; kết quả báo cáo bằng đường dẫn và commit, **không in giá trị**.
2. Kiểm `git ls-files` không chứa `.env*` (ngoài `.env.example`), `*.sqlite`, `data/`.
3. Gặp bí mật thật trong lịch sử thì **dừng và báo owner** (xoay khoá và cân nhắc viết lại lịch sử là quyết định của owner), không tự sửa.
4. Sạch thì owner tự đổi visibility trên GitHub (hoặc thay bằng việc thêm `tuantqse90` làm collaborator, theo plan §9).

## 4. Đóng băng (U-43)

Từ khi O1 xong tới khi nộp, bản nộp phải đúng bản đã kiểm.

- Tạo **tag** trên commit cuối (ví dụ `submission-2026-11-21`); README ghi tag đó. Tag, push và đổi visibility là việc của owner (AGENTS.md).
- Sau tag chỉ sửa **lỗi chặn demo**, mỗi lần có owner đồng ý, rồi chạy lại §5.
- `eval/results/latest.json` và số trong README phải cùng một lần chạy (không chạy lại `npm run eval` sau khi đã chép số, trừ khi cập nhật cả hai).
- Local cho video và Demo Day: ví provider ≥ 1 AVAX; **một API duy nhất** dùng khoá provider; `DEMO_STALL` chỉ bật khi quay đoạn §2b của demo rồi tắt; không chạy `npm run eval` trong giờ quay (Groq dùng chung).

## 5. Kiểm chứng

| Kiểm | Kỳ vọng |
|---|---|
| Mở từng link trong README ở cửa sổ **ẩn danh** (repo, Snowtrace, video, slide) | Mở được. Link repo mở được chỉ sau khi public |
| Snowtrace: trang contract | Thấy mã nguồn đã verify (nếu README nói "đã verify") |
| Số eval trong README | Bằng `latest.json` từng chữ số, kèm ngày và commit |
| Làm theo đúng phần "Cách chạy" trên bản clone mới (`npm ci`, `npm run verify`) | Xanh; nếu lệnh trong README sai thì sửa README |
| Quét bí mật (§3) | Không còn giá trị bí mật trong lịch sử |
| Đọc README đối chiếu quy tắc câu chữ (§2) | Không có câu nào rộng hơn bảng Q-10 |

**Báo cáo phải tách rõ:** đã chạy, chưa kiểm. Không ghi "đã verify trên Snowtrace" nếu chỉ đọc `fuji.json`.

## 6. Quyết định

| Mã | Câu hỏi | Chốt |
|---|---|---|
| **U-39, U-40, U-41, U-44** | Render, DB mới, giới hạn tần suất sau Vercel, chạy 5 câu demo trên bản deploy | **Không áp dụng** (không deploy). Mọi lần broadcast mới cho video là việc của O3 và cần owner đồng ý lúc đó |
| **U-42** | Repo công khai | ✅ Public khi nộp, sau quét bí mật (§3) |
| **U-43** | Đóng băng bằng tag, chỉ sửa lỗi chặn demo | ✅ (§4) |
| **Q-12** | SQLite khi deploy | Không áp dụng khi không deploy; vẫn đúng nếu sau này deploy |

## 7. Rủi ro và lịch

- **Lịch:** hôm nay 20/11, hạn nộp 21/11 (nên nộp **trước 20:00**). O1-lite không chặn video: quay từ bản local được ngay. README cần link video và slide, nên làm README trước, điền hai link sau.
- **Giám khảo không tự thử được ngoài video.** Đây là đánh đổi đã chấp nhận: bằng chứng nằm ở video, Snowtrace, `forge test` và số eval.
- **Demo Day (30/11):** vẫn dùng API local trên laptop như [demo §1](../runbook/demo.md) mô tả. Nếu về sau muốn deploy, bản đầy đủ (Render, Vercel) làm được sau hạn nộp; không cần đổi mã.
