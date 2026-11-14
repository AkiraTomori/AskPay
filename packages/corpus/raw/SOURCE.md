# Nguồn văn bản luật (raw)

> Thư mục `raw/` chứa **file gốc tải về, không sửa tay**. Script trong `packages/corpus` đọc từ đây để sinh `data/` (task C1, C2 trong [`docs/runbook/tasks.csv`](../../../docs/runbook/tasks.csv)).

## `blld-2019-goc.vbpl.html`

| | |
|---|---|
| Văn bản | Bộ luật Lao động số **45/2019/QH14**, ký ngày 20/11/2019, hiệu lực từ 01/01/2021 |
| Bản | **Văn bản gốc** (tab "Nội dung"), kèm dấu "Sao y bản chính" số 15/SY-VPCTN ngày 06/12/2019 |
| Nguồn | Cơ sở dữ liệu quốc gia về pháp luật: https://vbpl.vn/van-ban/chi-tiet/bo-luat-lao-dong-so-45-2019-qh14--139264 |
| Trạng thái trên vbpl.vn | "Hết hiệu lực một phần"; vbpl ghi ngày cập nhật 08/05/2026 |
| Lấy về lúc | 2026-11-14T01:31:35Z (ghi trong comment đầu file) |
| Cách lấy | Trình duyệt mở trang trên, lưu `innerHTML` của khung nội dung (`.ant-tabs-content-holder`) ra file. Dòng đầu là comment JSON ghi nguồn và thời điểm. **Không chỉnh sửa gì thêm.** |
| Kích thước | 472.885 byte |
| SHA-256 | `c25cb5def34c81154666cfdb23b241406ad0ca4de49445ebfd850bc04c3036eb` |

Kiểm tra lại: `sha256sum packages/corpus/raw/blld-2019-goc.vbpl.html`.

## Kiểm tra sơ bộ (14/11/2026)

Tách theo thẻ `<p>`, chuẩn hoá NFC và khoảng trắng:

- 1.329 đoạn có chữ.
- **220 Điều, đánh số liên tục 1→220** (AP-01-AC03).
- Khoảng 645 dòng bắt đầu bằng "N. " nằm dưới các Điều. Con số này còn tính nhầm phần trích dẫn luật khác trong Điều 219, nên chưa phải số Khoản cuối cùng.
- 37 Điều không chia Khoản; theo thiết kế, chúng là Khoản `0`.

## Những điểm parser (C1) phải xử lý

1. **Tiêu đề Chương bị dính tên chương**, ví dụ `Chương IIVIỆC LÀM, TUYỂN DỤNG…`, vì trong HTML có `<br>` ở giữa. Cần tách trước khi bỏ thẻ.
2. **12 Điều có đoạn dẫn trước Khoản 1.** Ví dụ Điều 25: "Thời gian thử việc do hai bên thỏa thuận… nhưng chỉ được thử việc một lần…", rồi mới tới khoản 1–4. Đoạn này có giá trị pháp lý nhưng không thuộc Khoản nào. **Đã chốt (owner, 14/11/2026): là Khoản `0` của Điều đó**, giống Điều không chia Khoản. Nguyên văn Khoản không gồm số thứ tự (owner, 14/11/2026). Xem system-design §6.
3. **Điều 219 trích nguyên văn điều khoản của luật khác** (Luật Bảo hiểm xã hội…), trong đó có cả dòng `“Điều 54. …` và các khoản đánh số riêng. Parser chỉ nhận tiêu đề Điều **không** bắt đầu bằng dấu ngoặc kép, và phải gom phần trích dẫn vào Khoản của Điều 219.
4. Các Điểm `a)`, `b)`… nằm trong nguyên văn Khoản (đúng thiết kế).

## Văn bản đã sửa đổi (cần owner quyết)

Bộ luật đã được sửa đổi, bổ sung bởi ba luật năm 2025. Văn bản hợp nhất **18/VBHN-VPQH ngày 12/02/2026** gộp các sửa đổi đó:

- Luật Công nghiệp công nghệ số 71/2025/QH15, hiệu lực 01/01/2026.
- Luật Dân số 113/2025/QH15, hiệu lực 01/07/2026.
- Luật Giáo dục nghề nghiệp 124/2025/QH15, hiệu lực 01/01/2026.

Ngày 14/11/2026, vbpl.vn **chưa** có văn bản hợp nhất này cho Bộ luật Lao động (tab "Các văn bản hợp nhất" và ô tìm kiếm đều không ra). File ở đây vì thế là **bản gốc 2019**. Nghĩa là một số Khoản có thể đã bị sửa và AskPay có thể trích nội dung không còn hiệu lực. Ba hướng xử lý (xem Q-06 trong spec):

- **(a) Giữ bản gốc, ghi rõ giới hạn.** Ghi "theo văn bản gốc năm 2019" trong UI và disclaimer; đánh dấu các Điều đã bị sửa nếu xác định được.
- **(b) Dùng văn bản hợp nhất 18/VBHN-VPQH** khi tìm được nguồn chính thức. Khi đó `lawId` phải gắn với phiên bản hợp nhất.
- **(c) Giữ bản gốc cho demo, chuyển sang bản hợp nhất trong roadmap.**

**Owner đã chọn (14/11/2026): dùng bản gốc cho demo** (gần với hướng (a)/(c)). UI và disclaimer phải ghi rõ "theo văn bản gốc Bộ luật Lao động 2019"; bản hợp nhất để trong roadmap.
