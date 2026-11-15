# W4 — Dashboard công khai `/dashboard`

> **Trạng thái:** đã duyệt (owner, 15/11/2026): U-16, U-17, U-19, U-20 theo đề xuất; U-18 chốt là **có link** vì repo sẽ public khi nộp. Ticket W4 ([tasks.csv](../runbook/tasks.csv)), hạn 17/11, P1. Phụ thuộc A6 (PR #16) và W3 (PR #19, đã merge).
> **Nguồn:**
> - [ui-pages §5](../product/ui-pages.md#5-dashboard) và [design-system](../product/design-system.md).
> - [frontend convention](../conventions/frontend.md).
> - [api.md §1, §5, §6](../architecture/api.md).
> - Spec AP-08 (owner đã duyệt cho W4 ngày 15/11/2026) và AP-09-AC03.
> - W1 U-02 (nav), W3 §3 (`isSettled`), U-11 (badge).
>
> Tài liệu này chỉ chốt giao diện và tương tác. Không đổi hành vi trong spec, không đổi API.

## 1. Người dùng và việc cần làm

- **Ai:**
  - Ban giám khảo, xem trên laptop khi demo hoặc mở link trên điện thoại. Họ không có ví và không cần ví.
  - Owner, khi kể bước 5 của kịch bản demo ("số câu hỏi, tỉ lệ hoàn tiền, kết quả eval").
- **Việc cần làm:** trong vài giây thấy được:
  - Hệ thống đã nhận bao nhiêu câu.
  - Bao nhiêu câu đã trả, bao nhiêu đã hoàn, và vì sao hoàn.
  - Provider đã nhận bao nhiêu tiền.
  - Chất lượng đo bằng eval.

  Bấm vào một câu thì sang trang kết quả. Bấm tx thì sang Snowtrace để tự kiểm.
- **Thông điệp phải đọc được:** số liệu tiền và trạng thái **tính từ event on-chain** (AP-08-AC02), không phải số tự khai của server.
- **Từ ngữ cố định:**
  - "Câu hỏi", "Đã thanh toán", "Đã hoàn tiền", "Tỉ lệ hoàn tiền", "Provider đã nhận".
  - "Tính từ event on-chain, khối #…".
  - Nhãn badge giống W3.
- **Không thuộc W4:**
  - Lọc, tìm kiếm, sắp xếp.
  - Biểu đồ theo thời gian.
  - Số liệu theo ví.
  - Xuất CSV.
  - Trang `/verify` (W5).

## 2. Bố cục

```
┌────────────────────────────────────────────────────────────┐
│ Dashboard                                                   │  h1
│ Số liệu công khai, tính từ event on-chain.                  │  mô tả
├──────────────┬──────────────┬──────────────┬───────────────┤
│ Câu hỏi      │ Đã thanh toán│ Đã hoàn tiền │ Provider đã   │  StatTile ×4
│ 42           │ 31           │ 11           │ nhận          │
│              │              │ 26,2% tỉ lệ  │ 1,55 USDC     │
├──────────────┴──────────────┴──────────────┴───────────────┤
│ Tính từ event on-chain, khối #38.123.456 · Contract 0x869e…↗ │  ProvenanceNote
├────────────────────────────────────────────────────────────┤
│ Lý do hoàn tiền                                             │  h2
│ Không có trích dẫn      ████████████████  6                 │  RefundReasonList
│ Checker từ chối         ████████          3                 │  (meter list)
│ Trích dẫn sai luật      ███               1                 │
│ Quá hạn                 ███               1                 │
│ Lỗi khi trả lời         ·                 0                 │
├────────────────────────────────────────────────────────────┤
│ Chất lượng (eval)                                           │  h2 — ẩn khi eval = null
│ Trích đúng Khoản 82% · Đạt checker 78% · Ngoài phạm vi 90%  │  EvalPanel
│ Chạy ngày 18/11/2026 · commit abc1234 ↗                     │
├────────────────────────────────────────────────────────────┤
│ Câu hỏi gần nhất                                            │  h2
│ Thời gian   Câu hỏi                     Trạng thái     Tx    │  QuestionTable
│ 15/11 21:40 Thử việc tối đa…            [ĐÃ THANH TOÁN] 0xf6…↗│
│ …                                                           │
│                       [ Xem thêm ]                          │
└────────────────────────────────────────────────────────────┘
```

**Thứ tự DOM và thứ tự đọc:** h1 → thẻ số liệu → ghi chú nguồn → lý do hoàn tiền → eval → bảng → "Xem thêm".

**Chọn hình thức theo dữ liệu** (dataviz skill, *choosing-a-form*):

| Phần | Dữ liệu | Hình thức | Lý do không dùng dạng khác |
|---|---|---|---|
| Bốn con số đầu trang | Mỗi số là một giá trị hiện tại | Hàng **stat tile** | Không vẽ biểu đồ một cột. Không có "hero figure", vì bốn số ngang hàng nhau |
| Lý do hoàn tiền | Năm phần của một tổng, cần so với nhau | **Meter list**: mỗi hàng có tên, thanh và con số. Một tông màu, xếp lớn → nhỏ | Không dùng pie hay donut. Không cần chú giải: tên nằm ngay trên hàng |
| Eval | Ba tỉ lệ độc lập | **Con số** (ba stat nhỏ) | Không vẽ thanh. Ba tỉ lệ không cùng một tổng và đều đã có chữ % |

## 3. Cây file

| File | Vai trò |
|---|---|
| `app/dashboard/page.tsx` | Mỏng, chỉ render `<DashboardView />` |
| `features/dashboard/api.ts` | `getStats()`, `getQuestions(cursor?)` qua `lib/api.ts`. Kiểu lấy từ shared (`statsSchema`, `questionListItemSchema`) |
| `features/dashboard/hooks.ts` | `useStats()`, `useRecentQuestions()` (§6) |
| `features/dashboard/dashboard-view.ts` | Hàm thuần: `Stats` → mô hình thẻ, danh sách lý do (đã xếp), eval; `QuestionListItem` → mô hình hàng. Có test đơn vị |
| `features/dashboard/components/DashboardView.tsx`, `StatTiles.tsx`, `ProvenanceNote.tsx`, `RefundReasonList.tsx`, `EvalPanel.tsx`, `QuestionTable.tsx` | Mỗi file dưới khoảng 200 dòng |
| `features/dashboard/messages.ts` | Chuỗi ở §9 |
| `components/question/StatusBadge.tsx`, `components/question/status.ts` | **Chuyển từ `features/ask`** (U-16). Lý do: convention cấm `features/dashboard` import `features/ask` |
| `components/layout/nav-items.ts` | Thêm "Dashboard" (W1 U-02: chỉ thêm khi trang có thật) |
| `lib/format.ts` | Thêm `formatPercentVi(ratio)` và `formatIntegerVi(n)` |

**Badge dùng chung (U-16):**
- `isSettled`, kiểu `Badge` và hàm mới `badgeOf({ status, settleTx })` chuyển sang `components/question/status.ts`.
- `features/ask/result-view.ts` gọi lại chúng.
- Nhờ vậy W3 và W4 dùng **cùng một** quy tắc "đã chốt" (W3 §3): `status ∈ {PAID, REFUNDED}` **và** có `tx.settle`.

## 4. Thẻ số liệu (`StatTiles`)

| Thẻ | Giá trị | Dòng phụ |
|---|---|---|
| Câu hỏi | `questions` | "đã giữ tiền" |
| Đã thanh toán | `paid` | — |
| Đã hoàn tiền | `refunded` | `formatPercentVi(refundRate)` + " tỉ lệ hoàn tiền" |
| Provider đã nhận | `formatUsdcVi(BigInt(providerRevenue))` + " USDC" | `≈ …đ (ước tính)` (dùng `formatVndEstimate`) |

**Cách hiển thị**
- Bố cục theo stat tile contract:
  - Nhãn: 14px, `ink-muted`, sentence case, không có dấu hai chấm.
  - Giá trị: 32px, sans semibold, `ink`, chữ số tỉ lệ (proportional). Đơn vị "USDC" của thẻ Provider là `<span>` 16px `ink-muted` nằm **trong cùng `<dd>`**, để số tiền dài vẫn vừa thẻ. Trình đọc màn hình vẫn đọc "1,55 USDC".
  - Dòng phụ: 14px, `ink-muted`.
- Không đổi màu chữ theo trạng thái (chữ không mang màu dữ liệu).
- Mỗi thẻ có một icon nhỏ cùng tông, đặt cạnh nhãn: `badge-check` (`paid`), `rotate-ccw` (`refund`). Hai thẻ còn lại không có icon.
- Mỗi thẻ là `Card` của W3.
- Thẻ là `<dl>`: nhãn là `<dt>`, giá trị là `<dd>`. Trình đọc màn hình đọc thành "Câu hỏi, 42".

**Định dạng số**
- Số nguyên dùng dấu chấm phân cách nghìn: `1.284`. Không rút gọn kiểu "1,3K", vì số trên Fuji nhỏ và người xem cần đúng số để đối chiếu Snowtrace.
- `formatPercentVi(0.262)` cho ra `26,2%`: một chữ số thập phân, tính từ số `number` của API. Đây là tỉ lệ để xem, không phải tiền.
- Tiền giữ `bigint` tới lúc hiển thị, không làm tròn (design-system §6).

**Trường hợp đặc biệt**
- **Chưa có câu nào chốt** (`paid + refunded = 0`): API vẫn trả `refundRate = 0`. Dòng phụ hiện "chưa có câu đã chốt" thay cho "0,0%", vì "0%" sẽ hiểu nhầm là không bao giờ hoàn tiền.
- **`paid + refunded < questions`:** đó là các câu đang xử lý hoặc quá hạn. Không hiện thêm số, không tự tính.

## 5. Ghi chú nguồn, lý do hoàn tiền, eval

### 5.1 `ProvenanceNote` (AP-08-AC02)

- Nội dung: "Tính từ event on-chain, khối #`formatIntegerVi(lastIndexedBlock)`" · "Contract `Address` ↗" (lấy từ `fujiDeployment.address`, link Snowtrace, giống footer W1).
- Cỡ chữ 14px, `ink-muted`, đặt ngay dưới thẻ số liệu.
- `lastIndexedBlock = 0` (indexer chưa chạy lần nào): hiện "Chưa đọc được event nào từ blockchain." Thẻ số liệu vẫn hiện 0.

### 5.2 `RefundReasonList`

- Năm hàng, lấy từ `refundsByReason`. API luôn trả đủ năm khoá.
- **Thứ tự:** lớn → nhỏ. Bằng nhau thì theo thứ tự cố định trong `REFUND_REASONS` của shared.
- **Tên hàng:** nhãn ngắn trong `features/dashboard/messages.ts` (§9). Câu đầy đủ `REFUND_REASONS[reason]` đặt trong `title` và trong tên dễ đọc của hàng.
- **Thanh:**
  - Chiều rộng = số / **giá trị lớn nhất** (không chia cho tổng), để hàng lớn nhất luôn chạy hết chiều dài.
  - Cao 8px, màu `refund`, nền ray `refund` pha 12%.
  - Bo 4px ở đầu dữ liệu, vuông ở gốc.
  - Hàng có giá trị 0 không vẽ thanh, chỉ có ray.
  - Tương phản: thanh `refund` trên `surface` là 5,10:1, trên ray là 4,07:1. Cả hai đạt ngưỡng ≥ 3:1 cho đồ hoạ.
- **Con số:** luôn in ở cuối hàng, `ink`, `tabular-nums` để các số thẳng cột. Không có tooltip: mọi số đã in sẵn, nên không có giá trị nào chỉ đọc được khi rê chuột.
- **A11y:**
  - Danh sách `<ol>`. Mỗi `<li>` đọc thành "Không có trích dẫn: 6 câu": tên, con số và chữ "câu" nằm trong nội dung `<li>` (hai phần phụ `sr-only`), không dùng `aria-label`.
  - Thanh là `aria-hidden`, vì con số đã có trong chữ.
  - Bản thân danh sách đã là "table view" của biểu đồ.
- **`refunded = 0`:** ẩn năm hàng, hiện "Chưa có câu nào bị hoàn tiền."

### 5.3 `EvalPanel` (AP-09-AC03)

- **`eval = null`:** **ẩn cả mục**, kể cả tiêu đề (ui-pages §5). Không hiện "chưa có" để khỏi làm demo trông dở dang. Tính tới 15/11/2026, repo chưa có `eval/results/latest.json`, nên mục này đang ẩn.
- **Có eval:** ba số `formatPercentVi`:
  - "Trích đúng Khoản" (`citationAccuracy`)
  - "Đạt checker" (`checkerPassRate`)
  - "Ngoài phạm vi đúng là không có căn cứ" (`outOfScopeCorrect`)
- **Dòng nguồn:** "Chạy ngày `runAt`" · "commit `abc1234`".
  - `runAt` là chuỗi. Có dạng `YYYY-MM-DD` thì đổi sang `dd/MM/yyyy`, không thì in nguyên văn.
  - Commit dài 7 ký tự, font mono, link tới `github.com/AkiraTomori/AskPay/commit/<commit>` (U-18).
- **Một câu giải thích nhỏ:** "Đo trên bộ khoảng 50 câu hỏi mẫu, không trả tiền thật."

## 6. Danh sách câu hỏi (`QuestionTable`)

**Nội dung từng hàng**
- **Thời gian:** `formatDateTimeVi(createdAt)` (giờ Việt Nam), `title` là ngày giờ đầy đủ.
- **Câu hỏi:**
  - API đã cắt ở 120 ký tự.
  - Trên màn hẹp, giới hạn thêm 2 dòng bằng `line-clamp-2`. `title` là chuỗi API trả về.
  - Đây là **link** tới `/questions/<qid>`.
- **Trạng thái:** `StatusBadge` với `badgeOf({ status, settleTx: tx.settle })`:
  - `PENDING`, hoặc `PAID`/`REFUNDED` chưa có `tx.settle` → ĐANG XỬ LÝ.
  - `CLAIMABLE` → QUÁ HẠN.
  - Không hiện lý do hoàn tiền trong bảng. Lý do có ở trang kết quả.
- **Tx:** `TxLink` của `tx.settle`. Không có thì hiện "—" kèm sr-only "chưa có tx".

**Cấu trúc HTML**
- `<table>` thật, có `<caption class="sr-only">Câu hỏi gần nhất</caption>` và `<th scope="col">`.
- Không bọc cả hàng trong link: link Snowtrace nằm trong hàng, mà link lồng link là sai.
- Cả hàng **bấm được bằng chuột** (cảm giác "bấm dòng" như ui-pages §5): `onClick` trên `<tr>` chuyển hướng như link câu hỏi. Bấm trúng `TxLink` thì không kích hoạt. Bàn phím vẫn chỉ dùng link câu hỏi, để mỗi hàng có đúng hai điểm Tab: câu hỏi và tx.
- Hover hàng: nền `paper`, chuyển trong 150ms.

**Responsive**
- **< 640px:** mỗi `<tr>` hiển thị như một khối. Câu hỏi ở trên. Dưới đó là badge, thời gian và tx trên một hàng. Ẩn hàng tiêu đề bằng `sr-only`, không xoá khỏi DOM.

**"Xem thêm"**
- Chỉ hiện khi có `meta.nextCursor`. Bấm thì tải 20 câu tiếp theo và nối vào cuối bảng.
- **Đang tải:** nút loading "Đang tải…", vô hiệu.
- **Lỗi:** nút trở lại, kèm dòng "Không tải thêm được. Thử lại." Các hàng đã có vẫn giữ nguyên.
- **Focus:** sau khi tải xong, focus chuyển tới link câu hỏi của hàng mới đầu tiên. Đồng thời thông báo `aria-live="polite"`: "Đã tải thêm 20 câu hỏi." Vùng thông báo được xoá rồi đặt lại chữ sau 100ms, để lần tải thứ hai cùng cỡ vẫn được đọc.
- **Hết trang:** nút biến mất.
- Hàng trùng `qid` (do trang đầu đã làm mới trong lúc đó) bị bỏ, giữ hàng mới nhất.
- Câu mới làm trang đầu đẩy hàng cũ ra ngoài (sau khi đã "Xem thêm") thì các hàng đó **được giữ lại** cùng các hàng đã tải, để không hàng nào biến mất. Thứ tự theo API: `createdAt` giảm dần, rồi `qid` giảm dần.

**Rỗng**
- **Rỗng thật** (trang đầu không có hàng nào): "Chưa có câu hỏi nào." + link nút "Hỏi câu đầu tiên" → `/`.
- **`questions > 0` nhưng danh sách rỗng** (DB mất nội dung, api.md §5): "Chưa có câu hỏi nào để hiển thị. Số liệu phía trên vẫn tính từ blockchain." Lời mời hỏi giữ nguyên.

## 7. Tải, làm mới, lỗi

| Phần | Đang tải lần đầu | Lỗi, chưa có dữ liệu | Lỗi khi đã có dữ liệu |
|---|---|---|---|
| Thẻ số liệu, ghi chú nguồn, lý do, eval (`useStats`) | Skeleton bốn thẻ cùng kích thước. Skeleton danh sách lý do. Mục eval chưa hiện | Một khung thay toàn bộ khối số liệu: "Không tải được số liệu." + "Thử lại". **Không** hiện số 0 | Giữ số cũ. Ghi chú nguồn thêm "· đang thử kết nối lại" |
| Bảng (`useRecentQuestions`) | Skeleton 5 hàng | "Không tải được danh sách câu hỏi." + "Thử lại" (khác với rỗng) | Giữ hàng cũ |

- **Hai khối độc lập:** `/stats` lỗi thì bảng vẫn hiện, và ngược lại. Mỗi khối có nút thử lại riêng.
- **`429 RATE_LIMITED`:** dùng câu `ERROR_CODES.RATE_LIMITED`, nút thử lại vẫn có. Lỗi khác dùng câu chung ở trên, không hiện mã lỗi.
- **Làm mới tự động** (TanStack Query):
  - `/stats` và **trang đầu** của bảng: làm mới mỗi **15 giây** khi tab đang mở, và khi cửa sổ được focus lại.
  - Tab ở nền thì dừng.
  - Server giữ cache 5 giây (api.md §1), nên 15 giây không làm tăng tải đọc đáng kể: 8 lần mỗi phút, so với giới hạn 120.
- **Trang 2 trở đi** không tự làm mới. Lý do: chỉ cần trang đầu có câu mới; làm mới cả chuỗi trang thì tốn lượt đọc.
- **Không nháy:** giá trị đổi khi làm mới thì cập nhật tại chỗ, không hiện lại skeleton.
  - Không có `aria-live` cho các số tự cập nhật, để khỏi đọc liên tục.
  - Ngoại lệ duy nhất: thông báo "Đã tải thêm…" ở §6.
- **Số ở thẻ "Câu hỏi" lớn hơn số hàng của bảng (đã gặp khi kiểm thật 15/11: thẻ 19, bảng 12; sau đó owner bỏ 7 câu thử khỏi DB demo nên hai số khớp 12 = 12, xem [demo.md](../runbook/demo.md)):** đúng thiết kế. Thẻ đếm từ event on-chain; bảng cần nội dung câu hỏi, chỉ có trong DB (api.md §5). Câu nào còn trên chain mà DB không có thì không có hàng. W4 không báo gì thêm trong giao diện, vì chỉ biết sự chênh sau khi bấm hết "Xem thêm". Nguyên nhân của 7 câu thiếu ở lần kiểm này chưa được kiểm trong DB. Cách đối phó khi demo ở [demo.md §4](../runbook/demo.md).
- **Lệch nhịp giữa `/stats` và trang đầu:** hai endpoint cache riêng, có thể lệch nhau tới 5 giây. Ví dụ một câu đã ĐÃ THANH TOÁN trong bảng nhưng chưa được tính trong thẻ. Chấp nhận, không đồng bộ ở web.

## 8. A11y, bàn phím, responsive

- h1 "Dashboard". Mỗi mục có h2. `document.title` = "Dashboard · AskPay". Nav đặt `aria-current="page"`.
- **Thứ tự Tab:** link Contract → link commit (nếu có eval) → từng hàng (câu hỏi, rồi tx) → "Xem thêm". Thẻ số liệu không nhận focus.
- **Màu không phải tín hiệu duy nhất:** badge có chữ và icon. Danh sách lý do có tên và con số.
- **Chuyển động:**
  - Skeleton và chuyển hover ≤ 200ms.
  - Icon xoay của ĐANG XỬ LÝ dừng khi `prefers-reduced-motion` (đã có ở W3).
  - Thanh lý do không có hiệu ứng mọc dần.
- **Bố cục theo độ rộng:**
  - ≥ 1024px: bốn thẻ một hàng trong khung 768px.
  - 640–1023px: 2×2.
  - < 640px: 2×2 với giá trị 24px. Nếu "1.550,25 USDC" không vừa thì xuống 1 cột.
  - Kiểm ở 360px: không cuộn ngang. Hash và số tiền không bị cắt.
- **Lighthouse a11y ≥ 90** trên `/dashboard` (design-system §8).
- **Disclaimer:** chỉ banner ở chân trang (W1). Trang này không có nội dung pháp lý nên không lặp disclaimer.

## 9. Chuỗi giao diện (`features/dashboard/messages.ts`)

```
title: 'Dashboard'      intro: 'Số liệu công khai, tính từ event on-chain.'
navLabel: 'Dashboard'   // thêm vào lib/messages (nav dùng chung)
tiles: { questions: 'Câu hỏi', paid: 'Đã thanh toán', refunded: 'Đã hoàn tiền', revenue: 'Provider đã nhận' }
questionsSub: 'đã giữ tiền'
refundRateSub: (pct) => `${pct} tỉ lệ hoàn tiền`      noSettledYet: 'chưa có câu đã chốt'
provenance: (block) => `Tính từ event on-chain, khối #${block}`
noEventsYet: 'Chưa đọc được event nào từ blockchain.'   reconnecting: 'đang thử kết nối lại'
reasonsTitle: 'Lý do hoàn tiền'   noRefunds: 'Chưa có câu nào bị hoàn tiền.'
reasonLabel: { NO_CITATION: 'Không có trích dẫn', INVALID_CITATION: 'Trích dẫn sai luật đã đăng ký',
               CHECKER_REJECTED: 'Checker từ chối', ANSWER_FAILED: 'Lỗi khi trả lời', TIMEOUT: 'Quá hạn' }
reasonCount: (n) => `${n} câu`
evalTitle: 'Chất lượng (eval)'
evalMetrics: { citationAccuracy: 'Trích đúng Khoản', checkerPassRate: 'Đạt checker',
               outOfScopeCorrect: 'Ngoài phạm vi đúng là không có căn cứ' }
evalRun: (date) => `Chạy ngày ${date}`   evalNote: 'Đo trên bộ khoảng 50 câu hỏi mẫu, không trả tiền thật.'
recentTitle: 'Câu hỏi gần nhất'
columns: { time: 'Thời gian', question: 'Câu hỏi', status: 'Trạng thái', tx: 'Tx' }
noTx: 'chưa có tx'   loadMore: 'Xem thêm'   loadingMore: 'Đang tải…'
loadedMore: (n) => `Đã tải thêm ${n} câu hỏi.`   loadMoreFailed: 'Không tải thêm được. Thử lại.'
empty: 'Chưa có câu hỏi nào.'   askFirst: 'Hỏi câu đầu tiên'
emptyButCounted: 'Chưa có câu hỏi nào để hiển thị. Số liệu phía trên vẫn tính từ blockchain.'
statsFailed: 'Không tải được số liệu.'   listFailed: 'Không tải được danh sách câu hỏi.'   retry: 'Thử lại'
```

- Nhãn badge lấy từ `components/question` (U-16).
- Câu đầy đủ của lý do lấy từ `REFUND_REASONS`. Câu lỗi theo mã lấy từ `ERROR_CODES`.
- Không có chuỗi nào chứa "Đã xác minh" (giữ test W3-E18).

## 10. Ví dụ chấp nhận

Test chạy Vitest + Testing Library, với `fetch` giả trả fixture theo `statsSchema` và `questionListItemSchema`.

| Mã | Cho / Khi / Thì | Kiểm bằng |
|---|---|---|
| W4-E01 (AP-08-AC01) | Fixture api.md §6 → bốn thẻ hiện `42`, `31`, `11` + `26,2% tỉ lệ hoàn tiền`, `1,55 USDC` + `≈ …đ (ước tính)`; mỗi thẻ đọc được thành cặp nhãn–giá trị (`<dt>`/`<dd>`) | Vitest |
| W4-E02 (AP-08-AC02) | Ghi chú "Tính từ event on-chain, khối #38.123.456" và link Contract đúng `fujiDeployment.address` | Vitest |
| W4-E03 | `paid = refunded = 0`, `refundRate = 0` → dòng phụ "chưa có câu đã chốt", không có "0%"; lý do hiện "Chưa có câu nào bị hoàn tiền." | Vitest |
| W4-E04 | `providerRevenue = "1550001"` → `1,550001 USDC` (không làm tròn); `"115792089237316195423570985008687907853269984665640564039457584007913129639935"` không ném lỗi | Vitest |
| W4-E05 | `refundsByReason` = 6/1/3/0/1 → thứ tự Không có trích dẫn, Checker từ chối, (Trích dẫn sai luật, Quá hạn theo thứ tự shared), Lỗi khi trả lời; thanh dài nhất 100%; hàng 0 không có thanh; mỗi hàng đọc "…: n câu" | Vitest (đơn vị `dashboard-view`) |
| W4-E06 (AP-09-AC03) | `eval = null` → không có tiêu đề "Chất lượng (eval)"; có eval → ba số `82%`, `78%`, `90%`, ngày `18/11/2026`, link commit | Vitest |
| W4-E07 (AP-08-AC01) | Bảng 20 hàng: link câu hỏi tới `/questions/<qid>`; `TxLink` tới Snowtrace `tx.settle`; hàng không có `tx.settle` hiện "—" | Vitest |
| W4-E08 (AP-07-AC03) | Hàng `status: PAID` không có `tx.settle` → badge ĐANG XỬ LÝ; `CLAIMABLE` → QUÁ HẠN; `REFUNDED` có tx → ĐÃ HOÀN TIỀN. Cùng hàm `badgeOf` với W3 (test W3 vẫn xanh sau khi chuyển file) | Vitest |
| W4-E09 | Bấm vào ô thời gian của hàng → sang trang câu hỏi; bấm `TxLink` → không chuyển trang (chỉ mở tab mới) | Vitest |
| W4-E10 | Có `nextCursor` → "Xem thêm" → gọi `?cursor=…` → 40 hàng, focus ở hàng 21, thông báo "Đã tải thêm 20 câu hỏi."; trang cuối không có `nextCursor` → nút biến mất; trùng `qid` → một hàng | Vitest |
| W4-E11 | "Xem thêm" lỗi → hàng cũ còn, "Không tải thêm được. Thử lại." | Vitest |
| W4-E12 | Danh sách rỗng, `questions = 0` → "Chưa có câu hỏi nào." + "Hỏi câu đầu tiên"; rỗng nhưng `questions = 3` → câu `emptyButCounted` | Vitest |
| W4-E13 | `/stats` 500 → khối số liệu "Không tải được số liệu." (không có số 0), bảng vẫn hiện; `/questions` 500 → ngược lại; 429 → câu `RATE_LIMITED` | Vitest |
| W4-E14 | Đã có dữ liệu, lần làm mới sau 15 giây lỗi → số cũ vẫn hiện + "đang thử kết nối lại"; lần sau thành công → cập nhật, không hiện skeleton | Vitest (fake timers) |
| W4-E15 | Không có ví / sai mạng → trang hiện đủ, không có lời mời kết nối | Vitest |
| W4-E16 | Nav có "Dashboard", `aria-current="page"` ở `/dashboard` | Vitest |
| W4-E17 | **Thật, chỉ đọc, không broadcast:** `npm run dev`, mở `localhost:3000/dashboard` → số thẻ khớp `curl localhost:4000/api/stats`; câu `0xdb76…` (W2-E19) có trong bảng với ĐÃ THANH TOÁN và tx `0xf64d…3323`; mở tx trên Snowtrace thấy event `Paid` | Thủ công |
| W4-E18 | 360px không cuộn ngang; bàn phím đi hết trang; Lighthouse a11y ≥ 90 | Thủ công |

W4-E17 là "Xong khi" của ticket ("Khớp /stats").

## 11. Quyết định (owner chốt 15/11/2026)

| Mã | Câu hỏi | Quyết định |
|---|---|---|
| U-16 | `StatusBadge` và `isSettled` đang nằm trong `features/ask`. Convention cấm `features/dashboard` import chéo. Chuyển đi đâu? | Chuyển sang `components/question/` (`StatusBadge.tsx`, `status.ts` có `isSettled`, `badgeOf`, kiểu `Badge`). `components/ui` không hợp, vì component này biết nghiệp vụ (giống `components/wallet`). Sửa import ở W3 trong cùng PR, và cập nhật `apps/web/ARCHITECTURE.md` |
| U-17 | Tự làm mới bao lâu một lần? | 15 giây cho `/stats` và trang đầu, cộng thêm khi focus cửa sổ. Dừng ở tab nền. Trang 2+ không làm mới |
| U-18 | Link commit eval trỏ tới repo GitHub `AkiraTomori/AskPay`. Repo có public khi nộp không? | **Có link**: repo sẽ public khi nộp (cần cho tiêu chí minh bạch của spec §8). Hằng `REPO_URL` đặt trong `lib/constants.ts` |
| U-19 | Danh sách lý do có hiện cả hàng giá trị 0 không? | **Có**, đủ năm hàng. Người xem thấy được các lý do có thể xảy ra (ví dụ `INVALID_CITATION` chỉ có khi giả lập gian lận), và thứ tự không nhảy khi một lý do có câu đầu tiên |
| U-20 | Nhãn "Trích dẫn sai luật đã đăng ký" cho `INVALID_CITATION` có nói quá không? (spec §8: "Không được nói 'Blockchain phát hiện AI trích bịa'") | Câu này chỉ nói Khoản được gửi lên không khớp luật đã đăng ký, đúng bảng lời khẳng định ở spec §8 (Contract kiểm Merkle proof). Không dùng "bịa" hay "AI". Owner xác nhận câu chữ |

## 12. Ngoài phạm vi W4

- Lọc theo trạng thái hoặc lý do, tìm kiếm, sắp xếp.
- Biểu đồ theo thời gian.
- Số liệu của riêng ví đang kết nối.
- Hiển thị địa chỉ người hỏi.
- Xuất CSV.
- Trạng thái `/health` (số dư ví provider) trên trang công khai.
- Đồng bộ thời điểm giữa `/stats` và `/questions`.
- Chế độ tối.
