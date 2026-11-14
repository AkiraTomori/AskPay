# AskPay v1 — Đặc tả sản phẩm

**Trạng thái:** BẢN NHÁP (09/11/2026), chờ owner duyệt. Các quyết định mở ở §6. Khi owner chốt, cập nhật bảng ở đó và đổi trạng thái file này thành ĐÃ DUYỆT.

**Quy ước trong file này:**
- **Đã chốt:** owner đã đồng ý trong trao đổi ngày 09/11/2026 (đề AskPay, stack, làm một mình, kiến trúc escrow + Merkle).
- **Đề xuất:** các phần còn lại, chưa ai chốt.
- Tiêu chí chấp nhận ghi theo dạng *Cho / Khi / Thì*, mã `AP-xx-ACnn`. Mỗi tiêu chí phải có ít nhất một test (Vitest hoặc Foundry) hoặc một bước trong kịch bản demo (§7).

## 1. Vấn đề và kết quả mong muốn

**Vấn đề.** Sinh viên đi làm thêm và người lao động trẻ hay thắc mắc về quyền lợi: thử việc, làm thêm giờ, nghỉ việc, lương. Họ hỏi chatbot AI thì nhận được câu trả lời tự tin nhưng hay **bịa số Điều** hoặc trích sai luật, và họ không có cách kiểm tra. Còn thuê luật sư thì quá đắt cho một câu hỏi nhỏ.

**Kết quả mong muốn.** Người dùng hỏi một câu và trả một khoản rất nhỏ cho đúng câu đó. Họ nhận câu trả lời có trích **nguyên văn Điều/Khoản** của Bộ luật Lao động 2019. Họ **chỉ mất tiền khi trích dẫn qua được kiểm tra**. Quy tắc trả hay hoàn tiền nằm trong smart contract. Contract kiểm Khoản được trích có thật trong văn bản luật đã đăng ký, kiểm chữ ký kết luận của checker, rồi tự chuyển tiền. Ai cũng tự xác minh được kết quả. Phạm vi của từng lời khẳng định ở §8.

**Thông điệp demo (một câu):** *"Trích dẫn không qua kiểm tra thì hoàn tiền, và chính smart contract trả tiền lại cho bạn."*

## 2. Người dùng và vai trò

| Vai trò | Là ai | Cần gì |
|---|---|---|
| **Người hỏi** | Người dùng có ví (Core, MetaMask) trên Fuji | Hỏi, trả tiền, nhận câu trả lời đáng tin hoặc nhận lại tiền |
| **Buyer agent** *(tuỳ chọn, AP-10)* | Chương trình gọi API qua x402 | Tự trả tiền, có trần ngân sách |
| **Provider** | Server AskPay (ví provider) | Nhận tiền khi câu trả lời đạt |
| **Checker** | Thành phần kiểm tra trong server, có khoá ký riêng | Ký kết luận đạt hoặc không đạt cho mỗi câu trả lời |
| **Owner** | Akira | Deploy contract, đăng ký Merkle root của văn bản luật |
| **Người quan sát** | Giám khảo, bất kỳ ai | Xem dashboard, mở tx trên Snowtrace, tự kiểm tra |

Không có tài khoản hay đăng nhập. **Địa chỉ ví là danh tính.**

## 3. Thuật ngữ

| Thuật ngữ | Nghĩa |
|---|---|
| **Điều / Khoản / Điểm** | Cấu trúc văn bản luật. Đơn vị trích dẫn của AskPay là **Khoản**; các Điểm nằm trong nội dung Khoản. Điều không chia Khoản được coi là một Khoản số 0. |
| **Corpus** | Bộ luật Lao động 2019 (Luật số 45/2019/QH14) đã tách thành danh sách Khoản, mỗi Khoản có nguyên văn. |
| **Leaf** | Mã băm của một Khoản: `(lawId, điều, khoản, hash(nguyên văn))`. |
| **lawRoot** | Merkle root của tất cả leaf trong corpus, được đăng ký lên contract. |
| **qid** | Mã duy nhất của một câu hỏi. Khoản tiền được ràng buộc với đúng qid đó. |
| **Escrow** | Contract `AskPayEscrow`: giữ tiền tới khi chốt. |
| **Chốt (settle)** | Contract quyết định **Paid** (trả cho provider) hoặc **Refunded** (hoàn cho người hỏi). |

## 4. Phạm vi

**Trong v1 (đã chốt):**
- Một văn bản luật (Bộ luật Lao động 2019).
- Một mạng (Avalanche Fuji).
- Một provider và một checker, chạy trong cùng server nhưng dùng hai khoá khác nhau.
- Web UI để hỏi, xem kết quả và xem dashboard.
- Bộ eval.

**Ngoài v1 (roadmap, chỉ nêu trong slide):**
- Nhiều văn bản luật, nghị định, theo dõi văn bản hết hiệu lực.
- Mainnet, L1 riêng.
- Checker độc lập hoặc có staking/slashing.
- Nhiều provider cạnh tranh, khiếu nại sau khi chốt.
- Tài khoản người dùng, lịch sử cá nhân, app mobile, tiếng Anh.
- Tư vấn theo hồ sơ cá nhân, soạn đơn từ.

## 5. Tính năng và tiêu chí chấp nhận

### AP-01 Corpus luật và Merkle root

Hệ thống có bản Bộ luật Lao động 2019 dạng có cấu trúc. Merkle root của nó nằm trên chain, nên mọi trích dẫn đều đối chiếu được.

- **AP-01-AC01** · Cho file văn bản gốc, khi chạy script tạo corpus, thì sinh ra danh sách Khoản (điều, khoản, tiêu đề Điều, nguyên văn) **và** Merkle root. Chạy lại trên cùng đầu vào cho ra **cùng root**.
- **AP-01-AC02** · Nguyên văn được chuẩn hoá Unicode NFC và khoảng trắng trước khi băm. Hai bản giống nhau về chữ nhưng khác cách mã hoá dấu cho ra cùng leaf.
- **AP-01-AC03** · Số Điều trong corpus khớp văn bản gốc (220 Điều). 20 Điều đầu được owner đối chiếu thủ công.
- **AP-01-AC04** · Sau khi owner đăng ký root lên contract, ai cũng xem được root đó on-chain. Bất kỳ ai cũng dựng lại được root từ corpus trong repo.

### AP-02 Đặt câu hỏi và nhận báo giá

- **AP-02-AC01** · Cho người hỏi nhập câu hỏi hợp lệ, khi gửi lần đầu (chưa kèm thanh toán), thì hệ thống trả **402** kèm giá, token, địa chỉ escrow, qid và hạn thanh toán. Chưa có tiền nào bị trừ.
- **AP-02-AC02** · Câu hỏi rỗng hoặc dài quá giới hạn (đề xuất 500 ký tự) bị từ chối với lỗi rõ ràng, không tạo báo giá.
- **AP-02-AC03** · UI hiện giá bằng USDC (kèm số tiền quy đổi gần đúng sang VND) **trước** khi ví hỏi ký.

### AP-03 Trả tiền vào escrow (x402)

- **AP-03-AC01** · Cho báo giá còn hạn, khi người hỏi ký uỷ quyền chuyển tiền (EIP-3009) và gửi lại câu hỏi kèm chữ ký, thì đúng số tiền báo giá chuyển từ ví người hỏi vào **escrow**, gắn với qid. Contract phát event `Deposited`.
- **AP-03-AC02** · Chữ ký sai, hết hạn, sai số tiền hoặc gắn với qid khác thì bị từ chối. Không có tiền nào chuyển đi.
- **AP-03-AC03** · Gửi lại cùng một chữ ký lần thứ hai (replay) không trừ tiền thêm lần nào.
- **AP-03-AC04** · Nội dung câu hỏi gửi kèm thanh toán phải trùng với câu hỏi đã báo giá cho qid đó. Khác thì bị từ chối.
- **AP-03-AC05** · Người hỏi không có hoặc không đủ token thì thấy số dư, giá câu hỏi và link faucet. Không có giao dịch nào bị gửi đi.
- **AP-03-AC06** · Lệnh giữ tiền đã được gửi lên chain nhưng hệ thống chưa biết kết quả. Khi đó người hỏi **không** bị báo "thanh toán thất bại" và **không** được mời xin báo giá mới. UI chuyển sang chờ, tới khi chain cho biết tiền đã vào escrow hay chưa. Nhờ vậy người hỏi không bao giờ trả hai lần cho một câu hỏi. *(Q-11)*
- **AP-03-AC07** · Ví provider không đủ phí gas cho cả lệnh giữ tiền lẫn một lệnh chốt, thì hệ thống từ chối nhận thanh toán **trước khi** giữ tiền. Người hỏi thấy "hệ thống tạm không nhận câu hỏi". Không có tiền nào chuyển đi. *(Q-11)*

### AP-04 Trả lời có trích dẫn

- **AP-04-AC01** · Khi tiền đã vào escrow, hệ thống trả lời bằng tiếng Việt, kèm **danh sách trích dẫn** (Điều, Khoản, đoạn trích nguyên văn).
- **AP-04-AC02** · Trích dẫn chỉ được chọn trong các Khoản mà bước tìm kiếm đã trả về. Mô hình không thể trích một Điều/Khoản không tồn tại trong corpus.
- **AP-04-AC03** · Câu hỏi nằm ngoài Bộ luật Lao động (ví dụ luật giao thông) thì hệ thống trả lời "không tìm thấy căn cứ trong Bộ luật Lao động 2019" và **không trích dẫn**, nên câu đó được hoàn tiền (AP-05-AC02).
- **AP-04-AC04** · LLM lỗi hoặc quá thời gian thì câu hỏi được chốt **Refunded**, lý do "không trả lời được".
- **AP-04-AC05** · Tiền đã vào escrow mà checker lỗi (bước chấm liên quan lỗi hoặc quá giờ sau một lần thử lại, hoặc không ký được). Khi đó câu hỏi được chốt **Refunded**, lý do "không trả lời được" (`ANSWER_FAILED`). Lý do **không** được là `CHECKER_REJECTED`, vì trích dẫn chưa được kiểm. *(Q-11)*

### AP-05 Kiểm tra trích dẫn và chốt tiền (lõi của sản phẩm)

Một câu trả lời **đạt** khi thoả cả ba điều kiện:
1. Có ít nhất một trích dẫn.
2. **Mọi** trích dẫn có Merkle proof khớp `lawRoot`: Khoản có thật trong văn bản đã đăng ký, và nguyên văn Khoản không bị sửa. Phần này kiểm **on-chain**.
3. Checker kết luận đạt và ký: đoạn trích nằm trong nguyên văn Khoản, và Khoản liên quan tới câu hỏi. Phần này kiểm **off-chain**; chain chỉ kiểm chữ ký. Chữ ký cam kết đúng đoạn trích đã được duyệt (Q-09), nhưng chain **không** tự kiểm đoạn trích có nằm trong nguyên văn hay không.

- **AP-05-AC01** · Câu trả lời đạt thì contract chuyển tiền cho provider (**Paid**) và phát event `Paid`.
- **AP-05-AC02** · Câu trả lời không có trích dẫn thì **Refunded**, lý do `NO_CITATION`.
- **AP-05-AC03** · Có một trích dẫn mà proof không khớp root thì **Refunded**, lý do `INVALID_CITATION`, kể cả khi các trích dẫn khác đúng.
- **AP-05-AC04** · Checker kết luận không đạt (trích không khớp nguyên văn hoặc không liên quan) thì **Refunded**, lý do `CHECKER_REJECTED`.
- **AP-05-AC05** · Chữ ký checker giả hoặc ký cho câu trả lời khác thì contract từ chối lệnh chốt. Tiền vẫn nằm trong escrow.
- **AP-05-AC06** · Một qid chỉ được chốt **một lần**. Lệnh chốt thứ hai bị từ chối.
- **AP-05-AC07** · Tiền chỉ đi tới đúng người hỏi (hoàn) hoặc đúng provider (trả), không tới địa chỉ nào khác.
- **AP-05-AC08** · Server khởi động lại, kể cả khi mất toàn bộ dữ liệu server, thì mọi câu hỏi còn tiền trong escrow đều được xử lý. Câu đó hoặc được chốt (Paid, hoặc Refunded do server tự hoàn), hoặc người hỏi tự nhận lại được tiền khi quá hạn (AP-06). Câu không còn nội dung trên server thì được tự hoàn tiền, người hỏi không cần làm gì. Trong 60 giây cuối trước hạn, server chỉ hoàn tiền, không chốt Paid. *(Q-11)*

### AP-06 Tự rút tiền khi quá hạn

- **AP-06-AC01** · Câu hỏi đã nộp tiền mà chưa được chốt sau thời hạn trả lời (đề xuất 10 phút), thì người hỏi gọi được lệnh rút và nhận lại đủ tiền. Không cần server.
- **AP-06-AC02** · Gọi lệnh rút trước hạn, hoặc gọi cho câu đã chốt, thì bị từ chối.
- **AP-06-AC03** · Trang kết quả hiện nút "Nhận lại tiền" khi câu hỏi đã quá hạn mà chưa chốt.

### AP-07 Trang kết quả và xác minh

- **AP-07-AC01** · Mỗi câu hỏi có một trang riêng (`/questions/<qid>`) mở được bằng link. Trang hiện câu hỏi, câu trả lời, trạng thái **Paid / Refunded / Đang xử lý / Quá hạn**, lý do nếu bị hoàn tiền, và link tx trên Snowtrace.
- **AP-07-AC02** · Mỗi trích dẫn hiện thành một thẻ (Điều, Khoản, đoạn trích). Mở thẻ ra xem được nguyên văn đầy đủ của Khoản. Thẻ có dấu xác minh **hai dòng** (Q-10):
  - Dòng chính: **"✓ Khoản có trong luật đã đăng ký on-chain"**.
  - Dòng phụ: **"Đoạn trích và mức liên quan: checker đã ký"**.

  Dấu này chỉ hiện khi câu hỏi đã Paid **và** `verifiedOnChain = true`. Không nơi nào trên UI được hiện dòng chính mà thiếu dòng phụ.
- **AP-07-AC03** · Trong lúc chờ, UI hiện từng bước: đã giữ tiền → đang trả lời → đang kiểm tra → đang chốt. UI không bao giờ hiện "Đã trả" hay "Đã xác minh" trước khi có receipt on-chain.
- **AP-07-AC04** · Disclaimer "Thông tin tham khảo, không thay thế tư vấn pháp lý" luôn hiện.

### AP-08 Dashboard công khai

- **AP-08-AC01** · Trang `/dashboard` hiện:
  - Tổng số câu hỏi.
  - Số câu Paid và Refunded, tỉ lệ hoàn tiền.
  - Tổng tiền provider đã nhận.
  - Danh sách câu hỏi gần nhất, mỗi câu kèm link tx.
- **AP-08-AC02** · Số liệu tiền và trạng thái lấy từ event on-chain. Nếu dữ liệu lưu ở server lệch với chain thì hiển thị theo chain.

### AP-09 Bộ đánh giá (eval)

- **AP-09-AC01** · Có bộ khoảng 50 câu hỏi, mỗi câu kèm Điều/Khoản đúng (do owner gán) và nhóm câu (thử việc, làm thêm giờ, nghỉ việc, lương, ngoài phạm vi).
- **AP-09-AC02** · Một lệnh chạy cả bộ câu hỏi (không trả tiền thật) và báo ba số:
  - Tỉ lệ trích dẫn đúng Khoản.
  - Tỉ lệ câu đạt checker.
  - Tỉ lệ câu ngoài phạm vi được trả lời đúng là "không có căn cứ".
- **AP-09-AC03** · Kết quả eval được ghi vào README và slide, kèm ngày chạy và commit.

### AP-10 Buyer agent *(tuỳ chọn, chỉ làm nếu đúng lịch tới 18/11)*

- **AP-10-AC01** · Một chương trình dòng lệnh nhận danh sách câu hỏi, tự trả qua x402 và in kết quả.
- **AP-10-AC02** · Agent có trần ngân sách. Khi khoản trả tiếp theo vượt trần thì agent dừng và báo, không ký.

## 6. Quyết định mở (owner chốt)

| Mã | Câu hỏi | Lựa chọn | Đề xuất | Chốt |
|---|---|---|---|---|
| Q-01 | Dùng LLM của nhà cung cấp nào? | Claude / Gemini / OpenAI | Chọn bên bạn đang có credit hoặc free tier. Chất lượng tiếng Việt và khả năng trả JSON ổn định quan trọng hơn giá | ✅ Owner chốt 14/11/2026: **Groq, model `qwen/qwen3.8-27b`**. Lý do (POC-3): 0,7 giây mỗi câu, 10/10 JSON hợp lệ ba lần chạy, 10/10 trích dẫn đúng nguyên văn. Model miễn phí của OpenRouter bị loại vì trung vị khoảng 36 giây, vượt ngân sách 20 giây. Hạn mức miễn phí của Groq là 8.000 token mỗi phút (khoảng 3 đến 4 câu mỗi phút) và 1.000 yêu cầu mỗi ngày; quá hạn mức thì câu bị hoàn tiền `ANSWER_FAILED`. Câu hỏi của người dùng được gửi tới Groq. |
| Q-02 | Giá mỗi câu hỏi? | 0,01 / 0,05 / 0,10 USDC | **0,05 USDC** (khoảng 1.300đ): đủ nhỏ để gọi là micropayment, đủ lớn để thấy rõ trên Snowtrace | ⬜ |
| Q-03 | Dùng token nào? | USDC testnet của Circle trên Fuji / token demo tự deploy | **USDC** nếu ngày 10/11 kiểm tra thấy hỗ trợ `receiveWithAuthorization`; không thì dùng token demo có EIP-3009 | ✅ Theo POC-1: USDC nếu POC-1 đạt, không thì `MockUSDC`; test luôn dùng `MockUSDC`. Owner chốt luật 14/11/2026. POC-1 đạt 14/11/2026 nên token là **USDC Fuji** |
| Q-04 | Bị hoàn tiền thì người hỏi có thấy câu trả lời không? | Hiện kèm cảnh báo đỏ / Ẩn, chỉ hiện các Khoản tìm được | **Hiện kèm cảnh báo** "Không đạt kiểm tra, đã hoàn tiền". Khớp tinh thần đề "không trích dẫn thì miễn phí" | ⬜ |
| Q-05 | Có một trích dẫn sai thì cả câu bị hoàn tiền? | Tất cả phải đúng / chỉ cần một trích dẫn đúng | **Tất cả phải đúng**: quy tắc chặt, dễ giải thích khi pitch | ✅ Tất cả phải đúng, owner chốt 14/11/2026 |
| Q-06 | Lấy văn bản luật gốc từ đâu? | vbpl.vn (Cơ sở dữ liệu quốc gia về văn bản pháp luật) / nguồn khác | **vbpl.vn**: nguồn chính thức, owner tải về và gửi file | ✅ vbpl.vn, owner chốt 14/11/2026 |
| Q-07 | Thời hạn trả lời trước khi người hỏi được tự rút tiền? | 5 / 10 / 30 phút | **10 phút** | ✅ 10 phút, owner chốt 14/11/2026 |
| Q-08 | Có làm AP-10 (buyer agent) không? | Có / Không | Chỉ làm nếu ngày 18/11 vẫn đúng lịch | ⬜ |
| Q-09 | Đoạn trích hiển thị cạnh dấu ✓ có được cam kết on-chain không, và cam kết bằng cách nào? (T-13) | `quoteHash` nằm trong `citationsHash` mà checker ký, `Paid` phát lại `citationsHash` / offset `(start, len)` trong nguyên văn / giữ nguyên, không cam kết | **`quoteHash`**: không đổi leaf và root. Chain cố định đoạn trích đã được duyệt; việc đoạn trích nằm trong nguyên văn vẫn là kết luận có chữ ký của checker | ✅ `quoteHash`, owner chốt 14/11/2026 |
| Q-10 | Pitch, demo và UI được khẳng định gì về kiểm chứng? | (a) Câu thông điệp: giữ câu cũ / "Trích dẫn không qua kiểm tra thì hoàn tiền, và chính smart contract trả tiền lại cho bạn." (b) Dấu trên thẻ: giữ "✓ Đã xác minh on-chain" / dấu hai dòng / dấu ngắn kèm giải thích. (c) Bước demo `#demo-fake`: giả lập server gian lận / thay bằng ca checker từ chối | Câu thông điệp mới; dấu hai dòng; giả lập server gian lận. Bảng lời khẳng định ở §8 là nguồn duy nhất | ✅ Cả ba theo đề xuất, owner chốt 14/11/2026 |
| Q-11 | Sau khi đã giữ tiền mà một bước hỏng thì chốt thế nào? ([system-design §5.6](../architecture/system-design.md)) | (a) Checker lỗi: `refundByProvider` (`ANSWER_FAILED`) / ký `pass = false` (`CHECKER_REJECTED`) / chờ `claimRefund`. (b) `settleCutoff`: 60 giây / 120 giây / không có. (c) Mất SQLite: tự `refundByProvider` / để người hỏi `claimRefund`. (d) Thêm tiêu chí chấp nhận cho các đường lỗi | `refundByProvider`; 60 giây; tự hoàn; thêm AP-03-AC06, AP-03-AC07, AP-04-AC05, AP-05-AC08 | ✅ Cả bốn theo đề xuất, owner chốt 14/11/2026 |
| Q-12 | Khi deploy, SQLite của API lưu ở đâu? (system-design T-14) | Ổ đĩa lưu bền (Render disk hoặc volume Railway, thường phải trả phí) / ổ đĩa tạm và không deploy lại sau khi chuẩn bị câu demo / chạy API trên laptop khi demo | **Ổ đĩa lưu bền**: deploy lại không mất nội dung câu hỏi, trang câu demo không bị trống. Chi phí: gói trả phí, kiểm giá khi tạo instance | ✅ Ổ đĩa lưu bền, owner chốt 14/11/2026 |
| Q-13 | Dấu xác minh và lời "người ngoài kiểm lại được" dựa trên gì? | (a) Nguồn của event `Paid` khi tính `verifiedOnChain`: đọc receipt qua RPC / đọc `chain_events` và chỉ nói "bắt được ghi sai". (b) Kiểm lại `citationsHash`: chỉ nói kiểm được bằng `packages/shared` / thêm bước kiểm vào `/verify` / cả hai | (a) đọc receipt qua RPC; (b) chỉ nói kiểm được bằng `packages/shared`, không thêm giao diện | ✅ Cả hai theo đề xuất, owner chốt 14/11/2026 |

## 7. Kịch bản demo (2–3 phút, dùng cho video và Demo Day)

1. Mở trang chủ, kết nối ví Core trên Fuji. Ví đang có USDC testnet.
2. Hỏi: *"Thời gian thử việc tối đa với công việc cần trình độ đại học là bao lâu?"*
   - Báo giá hiện ra, ký trong ví.
   - UI chạy qua từng bước. Kết quả: câu trả lời trích Điều 25, thẻ trích dẫn có dấu ✓, trạng thái **Paid**, mở tx trên Snowtrace.
3. Hỏi một câu ngoài phạm vi, ví dụ về nồng độ cồn khi lái xe.
   - Kết quả: "không có căn cứ", trạng thái **Refunded**, mở tx hoàn tiền trên Snowtrace.
4. *(Chế độ demo của owner)* **Giả lập server gian lận.** Server gửi một Khoản có nội dung khác bản luật đã đăng ký.
   - Merkle proof không khớp, contract tự hoàn tiền với lý do `INVALID_CITATION`.
   - Lời nói phải nêu rõ đây là **giả lập**. Không nói là AI trích bịa: trích dẫn bịa của LLM đã bị chặn off-chain từ trước, nhờ chỉ được chọn trong danh sách ứng viên (AP-04-AC02) và bước kiểm C2, C3.
5. Mở dashboard: số câu hỏi, tỉ lệ hoàn tiền, kết quả eval.

> Chế độ demo ở bước 4 chỉ bật được bằng cờ cấu hình của server, không lộ ra cho người dùng thường. Đây cũng là bằng chứng cho AP-05-AC03.

## 8. Ràng buộc và yêu cầu phi chức năng

- **Thời gian:** Từ lúc ký tới lúc có kết quả cuối, mục tiêu dưới 30 giây. Fuji xác nhận khoảng 2 giây mỗi tx; phần lớn thời gian còn lại là LLM.
- **Chi phí:**
  - Gas trên Fuji dùng AVAX testnet từ faucet. Ví provider cần đủ AVAX để gửi lệnh deposit và settle.
  - Instance API cần ổ đĩa lưu bền (Q-12), thường là gói trả phí của Render hoặc Railway. Đây là khoản chi bằng tiền thật, giống phí gọi LLM (Q-01). Kiểm giá khi tạo instance.
- **Bảo mật:** Khoá provider và khoá checker tách riêng. Không log nội dung câu hỏi ở mức info.
- **Tính minh bạch:** Corpus, script tạo root và địa chỉ contract đều công khai trong repo. Contract được verify trên Snowtrace.
- **Lời khẳng định về kiểm chứng (Q-10).** Đây là nguồn duy nhất cho mọi câu chữ trong pitch, kịch bản demo, UI và tài liệu. Câu nào nói rộng hơn bảng dưới đây thì phải sửa theo bảng.

  | Được nói | Ai bảo đảm |
  |---|---|
  | Khoản được trích có thật trong văn bản luật đã đăng ký, và nguyên văn Khoản không bị sửa | **Contract** (Merkle proof khớp `lawRoot`) |
  | Đoạn trích nằm trong nguyên văn Khoản, và Khoản liên quan tới câu hỏi | **Checker** (off-chain, ký EIP-712). Contract chỉ kiểm chữ ký. |
  | Đoạn trích hiển thị đúng là đoạn checker đã duyệt; nếu dữ liệu trên server bị sửa sau khi chốt thì dấu xác minh tắt | Chữ ký checker và `citationsHash` trong event `Paid` (Q-09). Server đối chiếu với log `Paid` **đọc thẳng từ RPC**, không đọc từ cơ sở dữ liệu của chính nó; lệch thì `verifiedOnChain = false` (Q-13). |
  | Người ngoài kiểm lại được đoạn trích mà không cần tin server | Dùng `citationsHash()` trong `packages/shared`, đối chiếu với `citationsHash` của event `Paid` trên Snowtrace. **v1 không có giao diện cho bước này** (Q-13). |
  | Trả hay hoàn tiền, và tiền chỉ về người hỏi hoặc provider | **Contract** |
  | LLM không trích được Khoản ngoài danh sách tìm kiếm | **Code server** (off-chain, AP-04-AC02) |

  **Không được nói:**
  - "Blockchain kiểm đúng nguyên văn đoạn trích."
  - "Blockchain phát hiện AI trích bịa."
  - "Checker độc lập." Ở v1, checker dùng khoá riêng nhưng do chính AskPay vận hành.
  - "Chain là lớp được tin tuyệt đối."
  - "Ai cũng kiểm được đoạn trích ngay trên trang `/verify`." Ở v1, `/verify` chỉ so Merkle root.
  - "Không ai sửa được đoạn trích." Kiểm RPC chỉ phát hiện việc sửa **dữ liệu**. Người kiểm soát code server vẫn có thể tắt bước kiểm này; khi đó chỉ người ngoài kiểm lại mới phát hiện được.

## 9. Ảnh hưởng tới dữ liệu và API (mức đặc tả)

- **API:** một endpoint hỏi (402 → trả → kết quả), một endpoint đọc kết quả theo qid, các endpoint cho dashboard và trang tự xác minh. Chi tiết ở [`../architecture/api.md`](../architecture/api.md); hình dạng chính xác là schema trong `packages/shared`.
- **Server lưu:** câu hỏi, câu trả lời, trích dẫn, tx hash, theo qid. Đây là dữ liệu để hiển thị. **Trạng thái tiền lấy từ chain.**
  - Dữ liệu nằm trên ổ đĩa lưu bền (Q-12), nên deploy lại không mất.
  - Ổ đĩa hỏng thì phần tiền được dựng lại từ chain, còn nội dung câu hỏi thì mất. Câu còn tiền trong escrow được tự hoàn (AP-05-AC08).
- **On-chain lưu:** trạng thái từng qid (người hỏi, số tiền, hạn, trạng thái), `lawRoot`, địa chỉ provider và checker, event cho mọi thay đổi.
- **Không lưu:** dữ liệu cá nhân ngoài địa chỉ ví. Không có email hay tên.

## 10. Ánh xạ sang lịch ([runbook/plan.md §6](../runbook/plan.md))

| Ngày | Tính năng |
|---|---|
| 10/11 | AP-01 |
| 11–12/11 | AP-03, AP-05, AP-06 (phần contract) |
| 13–15/11 | AP-02, AP-04, AP-05 (phần server) |
| 16–17/11 | AP-07, AP-08 |
| 18/11 | AP-09, (AP-10) |
