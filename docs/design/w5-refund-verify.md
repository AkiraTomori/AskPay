# W5 — Nhận lại tiền (`claimRefund`) và trang `/verify`

> **Trạng thái:** owner đã duyệt (15/11/2026): làm theo thiết kế này, lấy **đề xuất** của U-21..U-26 làm quyết định, riêng U-25 chọn **thêm cờ demo** (`DEMO_STALL`, [system-design §5.5b](../architecture/system-design.md)). Đang làm. Ticket W5 ([tasks.csv](../runbook/tasks.csv)), hạn 17/11, P1. Phụ thuộc W3 (PR #19) và W4 (PR #20), cả hai đã merge.
>
> **Lệch nhỏ so với bản đề xuất khi làm (agent ghi lại, chờ owner xác nhận):**
> - Bước 3 của `/verify` in `PUBLIC_RPC_URL` (RPC công khai mặc định), không phải `RPC_URL` như ví dụ W5-E17, để một endpoint có API key đặt qua `NEXT_PUBLIC_RPC_URL` không bao giờ hiện trên trang cho người lạ sao chép. Khi không đặt biến đó, hai giá trị bằng nhau.
> - `REFUND_REASON_BY_INDEX` chuyển từ `apps/api` sang `@askpay/shared/errors`: web cần cùng thứ tự để nhận log `Refunded`. API import lại từ shared; test đọc mã Solidity giữ nguyên.
>
> **Ghi chú, không phải lệch:**
> - Số Khoản thật là **687** (ví dụ 1.043 ở §5.1 chỉ là minh hoạ).
> - Lỗi `DeadlineNotReached(qid, deadline)` mang theo `deadline`, nên trạng thái `notYet` dùng đúng giá trị đó để biết chờ tới block nào.
>
> **Nguồn:**
> - [ui-pages §4.3, §6, §7](../product/ui-pages.md) và [design-system](../product/design-system.md).
> - [frontend convention](../conventions/frontend.md).
> - [contracts.md §2–§4, §6](../architecture/contracts.md).
> - [system-design P5, §5.6 D/E, §6](../architecture/system-design.md).
> - [api.md §4, §7](../architecture/api.md).
> - Spec AP-06, AP-01-AC04, AP-07-AC03, §8 (bảng lời khẳng định), Q-13.
> - W1 §5, W3 §3, §4, §7 và U-15. W4 U-16, U-18.
>
> Tài liệu này không đổi contract, không đổi API. Có một đề xuất đổi đầu ra của `packages/corpus` (U-22) và một đề xuất cờ demo ở API (U-25); cả hai chờ owner.

## 1. Người dùng và việc cần làm

| Phần | Ai | Việc |
|---|---|---|
| **A. Nhận lại tiền** (AP-06-AC03) | Người hỏi có câu quá 10 phút chưa chốt. Hoặc bất kỳ ai mở link câu đó: ai bấm cũng được, tiền luôn về ví người hỏi | Thấy câu đã quá hạn → bấm "Nhận lại tiền" → ký tx trong ví → thấy tiền đã về, kèm link tx. **Làm được cả khi API sập** (P5) |
| **B. `/verify`** (AP-01-AC04) | Giám khảo, người hoài nghi, owner lúc demo bước "Minh bạch" | Thấy root trong repo bằng root đã đăng ký trên contract. Thấy địa chỉ contract, provider, checker, thời hạn trả lời. Biết ba lệnh để tự kiểm mà không cần tin AskPay |

- **"Xong khi"** (ticket): demo được kịch bản server tắt → người hỏi tự rút tiền.
- **Từ ngữ cố định:**
  - "Nhận lại tiền", "Tiền sẽ về ví …", "Quá hạn".
  - "Root trong repo", "Root trên contract", "Khớp", "Lệch".
- **Không thuộc W5:**
  - Nhận lại tiền hàng loạt.
  - Thông báo đẩy khi câu quá hạn.
  - Kiểm `citationsHash` trên giao diện (Q-13: v1 không có).
  - So từng Khoản trên `/verify`.
  - Đổi provider hay checker.

## 2. Phần A — Khi nào hiện nút "Nhận lại tiền"

### 2.1 Nguồn sự thật về "được nhận lại"

Contract cho phép `claimRefund` khi `status == Open` **và** `block.timestamp > deadline` (contracts.md §4.2b). Web không tự kết luận quyền này. Nó chỉ quyết định **có hiện nút không**. Còn bấm được thật hay không thì do **mô phỏng tx** quyết định (§3).

Hiện nút trong ba tình huống:

| # | Trang đang ở trạng thái | Nguồn | Điều kiện hiện nút |
|---|---|---|---|
| 1 | API trả `status = CLAIMABLE` | `GET /questions/:qid` (W3) | Luôn hiện |
| 2 | API **không trả được dữ liệu**: lỗi mạng, 5xx, proxy, hoặc `404` | Đọc thẳng `questions(qid)` từ contract (§2.2) | `status == Open` và `deadline < timestamp của block mới nhất` |
| 3 | API trả `PENDING` nhưng đã quá `createdAt + answerWindow + 30 giây` theo đồng hồ máy | Như #2, đọc thêm từ contract | Như #2. Trường hợp này phủ lúc indexer lag hoặc đứng, khiến API chưa biết `deadline` |

- Thứ tự ưu tiên khi hai nguồn lệch: **chain thắng** (P2).
  - API nói `PENDING` mà chain nói `Open` quá hạn: hiện nút.
  - API nói `CLAIMABLE` mà chain nói `Refunded`: hiện kết quả của chain (§4).
- Không dùng đồng hồ máy người dùng để so với `deadline`. Dùng `timestamp` của block mới nhất (`useBlock`, chain 43113).

### 2.2 Chế độ "đọc từ blockchain" của trang kết quả

Khi API không trả được dữ liệu (#2), W3 hiện "Không tải được kết quả." hoặc "Không tìm thấy câu hỏi này." W5 thêm một bước: nếu `qid` đúng dạng bytes32, đọc `questions(qid)` và `useBlock()` bằng client công khai của wagmi. Việc này không cần kết nối ví.

| `questions(qid).status` | Hiển thị |
|---|---|
| Đang đọc | Giữ thông báo W3 kèm dòng "Đang đọc trạng thái tiền từ blockchain…" |
| `None` (0) | Như W3 (không tìm thấy / không tải được). Không có gì để nhận lại |
| `Open`, chưa tới hạn | Badge ĐANG XỬ LÝ + "Máy chủ không phản hồi. Tiền vẫn nằm trong escrow. Bạn tự nhận lại được sau {giờ:phút}." (giờ = `deadline`, giờ Việt Nam) + đếm ngược |
| `Open`, quá hạn | Badge QUÁ HẠN + **nút Nhận lại tiền** (§3) |
| `Paid` | Badge ĐÃ THANH TOÁN + "Máy chủ không phản hồi nên chưa hiện được câu trả lời." **Không** có dấu ✓ và không có thẻ trích dẫn (cần `verifiedOnChain` của server, AP-07-AC02) |
| `Refunded` | Badge ĐÃ HOÀN TIỀN + "Tiền đã được trả lại vào ví người hỏi." Không nêu lý do: struct không lưu lý do, lý do chỉ có trong event |
| Lỗi RPC | "Không đọc được blockchain lúc này." + "Thử lại". Không đoán gì |

- Khối này có tiêu đề nhỏ "**Trạng thái đọc thẳng từ blockchain**" kèm `Address` của escrow, để người xem biết số liệu không đến từ máy chủ AskPay.
- Câu hỏi (văn bản) chỉ có ở API. Khi API sập thì h1 là "Câu hỏi `0xdb76…d787`", dùng `shortHash`.
- **Badge ở chế độ này** đi qua cùng `components/question/status.ts` (W4 U-16). Thêm hàm `badgeOfChain({ status, deadline, now })` cạnh `badgeOf`. Không viết quy tắc thứ hai trong component.
- **Làm mới khi API vẫn lỗi:** đọc lại chain mỗi **15 giây** khi tab đang mở. Poll API của W3 vẫn chạy song song. API trả dữ liệu trở lại thì quay về giao diện W3 đầy đủ.

## 3. Phần A — Luồng nhận lại tiền

### 3.1 `ClaimRefundPanel`

Đặt trong `RefundNotice` kiểu `claimable` (W3), ngay dưới câu "Đã quá 10 phút mà chưa có kết quả."

```
┌ ⏰ Đã quá 10 phút mà chưa có kết quả. ────────────────────┐
│ Bạn nhận lại được 0,05 USDC. Không cần máy chủ AskPay.     │
│ Tiền sẽ về ví 0xab…cd (ví đã hỏi câu này).                 │
│ [ Nhận lại tiền ]                                          │
│ Phí gas trả bằng AVAX testnet từ ví đang kết nối.          │
└───────────────────────────────────────────────────────────┘
```

- **Người nhận:** `payer` lấy từ API, hoặc từ `questions(qid).payer` khi ở chế độ chain.
  - Ví đang kết nối **chính là** `payer`: "Tiền sẽ về ví của bạn (0xab…cd)."
  - Khác ví: "Tiền sẽ về ví 0xab…cd (ví đã hỏi câu này), không về ví đang kết nối."
- **Số tiền:** `amount` (API hoặc chain), `formatUsdcVi`.

### 3.2 Máy trạng thái `useClaimRefund(qid)`

```ts
type ClaimState =
  | { kind: 'idle' }
  | { kind: 'simulating' }
  | { kind: 'confirming' }                         // ví đang mở
  | { kind: 'pending'; hash: Hex }                // đã gửi, chờ receipt
  | { kind: 'refunded'; hash: Hex }               // receipt thành công + log Refunded khớp qid
  | { kind: 'alreadyClosed' }                     // QuestionNotOpen: người khác đã chốt trước
  | { kind: 'notYet'; deadline: bigint }          // DeadlineNotReached
  | { kind: 'failed'; error: ClaimError };
```

| Từ | Sự kiện | Sang | Người dùng thấy |
|---|---|---|---|
| `idle` | Bấm "Nhận lại tiền", ví `ready` | `simulating` | Nút loading "Đang kiểm tra…" |
| `simulating` | Mô phỏng qua | `confirming` → mở ví (`writeContract` với `request` vừa mô phỏng) | "Xác nhận trong ví…", nút vô hiệu |
| `simulating` | Revert `QuestionNotOpen` | `alreadyClosed` | **Không mở ví** (system-design §5.6 E). Refetch API và chain, rồi hiện trạng thái cuối. Câu `ink-muted`: "Câu hỏi này vừa được chốt, không cần nhận lại." |
| `simulating` | Revert `DeadlineNotReached` | `notYet` | "Blockchain chưa tới hạn (lệch vài giây với máy chủ). Thử lại sau {n} giây." Nút tự bật lại khi block mới vượt `deadline` |
| `simulating` | Lỗi RPC | `failed` (`rpc`) | "Không kiểm tra được với blockchain. Thử lại." |
| `confirming` | Từ chối ký (4001) | `idle` | "Bạn đã huỷ. Tiền vẫn nằm trong escrow." (`ink-muted`) |
| `confirming` | Ví thiếu AVAX trả gas | `failed` (`noGas`) | "Ví chưa có AVAX testnet để trả phí gas." + "Lấy AVAX testnet ↗" (U-24) |
| `confirming` | Lỗi ví khác (`classifyWalletError` của W1) | `failed` (`wallet`) | Câu lỗi ví của W1. Nút bấm lại được |
| `confirming` | Ví trả hash | `pending` | "Đang chờ blockchain xác nhận…" + `TxLink` "Nhận lại tiền" |
| `pending` | Receipt `success`, có log `Refunded(qid, …, Timeout)` từ đúng escrow | `refunded` | Xem §4. Invalidate số dư USDC (W1) |
| `pending` | Receipt `reverted` | `alreadyClosed` | Như hàng `QuestionNotOpen`. **Không báo lỗi** (ui-pages §4.3). Tx đã mất gas; nói rõ một dòng: "Tx của bạn không cần nữa vì câu đã được chốt trước." |
| `pending` | Chờ quá 60 giây hoặc RPC lỗi khi đọc receipt | Ở lại `pending` | Thêm "Chưa xác nhận được. Xem tx trên Snowtrace." Đọc lại receipt mỗi 5 giây. **Không** mời gửi tx mới khi chưa biết tx cũ ra sao |

- Mô phỏng và gửi dùng cùng `account = address` của ví đang kết nối và cùng `chainId: 43113`.
- **Trạng thái ví:**
  - `disconnected`: nút đổi thành "Kết nối ví để nhận lại tiền" và mở hộp thoại của W1.
  - `wrongNetwork`: nút đổi thành "Chuyển sang Fuji".
  - `loading`: hiện skeleton.
- Đổi tài khoản hay đổi mạng ở `simulating` hoặc `confirming`: bỏ kết quả, về `idle`. Đổi ở `pending`: **không** huỷ gì, vì tx đã gửi đi.
- **Gửi hai lần không mất tiền:** tx thứ hai chỉ revert `QuestionNotOpen` và tốn gas. Dù vậy, nút luôn vô hiệu từ `simulating` tới khi xong, để người dùng không tốn gas oan.
- **Không có "tự rút" ngầm:** không gửi tx nào nếu người dùng chưa bấm.

### 3.3 Ánh xạ lỗi từ contract

Lỗi custom được giải mã bằng ABI `askPayEscrowAbi` của shared (viem `ContractFunctionRevertedError.data.errorName`). Câu tiếng Việt lấy từ `ERROR_CODES` theo bảng contracts.md §6:

| Lỗi contract | Mã | Cách UI dùng |
|---|---|---|
| `QuestionNotOpen` | `QUESTION_ALREADY_SETTLED` | Không phải lỗi: refetch rồi hiện trạng thái cuối |
| `DeadlineNotReached` | `REFUND_NOT_YET` | Câu `notYet` ở trên. Câu shared "Chưa tới hạn tự nhận lại tiền." làm `title` |
| Khác | — | "Không nhận lại được tiền lúc này. Tiền vẫn nằm trong escrow." |

## 4. Sau khi nhận lại tiền thành công

**Vấn đề.** API chỉ biết câu đã hoàn tiền khi indexer đọc tới block chứa event, có thể chậm vài chục giây (w2-ask §15 ghi nhận 62–68 giây với settle). Nếu chỉ chờ API, badge sẽ đứng ở QUÁ HẠN ngay sau khi tiền đã về ví. Như vậy người dùng tưởng chưa xong.

**Đề xuất (U-21):** dùng chính receipt làm bằng chứng tạm.

- Chỉ chấp nhận khi:
  - receipt `status = success`, **và**
  - trong `logs` có log `Refunded` giải mã được bằng ABI, từ đúng địa chỉ `fujiDeployment.address`, đúng `qid`, `reason = Timeout`.

  Khi đó trang hiện:
  - badge **ĐÃ HOÀN TIỀN**
  - câu `REFUND_REASONS.TIMEOUT`
  - `TxLink` "Hoàn tiền" trỏ hash của tx này
  - số dư USDC được làm mới
- Đây là receipt on-chain, nên không trái AP-07-AC03 hay P2.
- Trạng thái tạm này **chỉ sống trong phiên trang**, không lưu.
- Ngay khi API trả `REFUNDED` đã chốt (`isSettled`), giao diện chuyển về dữ liệu API. Hash phải khớp; lệch thì theo API, vì API cũng đọc từ event.
- Trong lúc chờ API, trang poll API mỗi 3 giây (thay cho 10 giây của `CLAIMABLE`, W3 U-15), tối đa 2 phút.
- Nếu không dùng receipt (owner từ chối U-21): giữ QUÁ HẠN cộng dòng "Đã gửi tx nhận lại tiền, đang chờ máy chủ cập nhật…" tới khi API đổi.
- **Focus và đọc màn hình:** khi sang `refunded`, focus chuyển tới tiêu đề của `RefundNotice` mới. Vùng `aria-live` của badge (W3) đọc "Đã hoàn tiền".

## 5. Phần B — Trang `/verify`

### 5.1 Bố cục

```
┌──────────────────────────────────────────────────────────────┐
│ Tự xác minh                                                   │ h1
│ So bản luật trong repo với bản đã đăng ký trên blockchain.    │
├──────────────────────────────────────────────────────────────┤
│ Bộ luật                                                [✓ KHỚP]│ LawCard
│ Bộ luật Lao động 2019 (45/2019/QH14) · 220 Điều · 687 Khoản    │
│ lawId        0x…                                    [Sao chép] │
│ Root trong repo     0xda14ddb6…17a5                 [Sao chép] │
│ Root trên contract  0xda14ddb6…17a5                 [Sao chép] │
├──────────────────────────────────────────────────────────────┤
│ Contract                                                       │ ContractCard
│ Escrow     0x869e…dce0 ↗ (mã nguồn trên Snowtrace)             │
│ Provider   0x0719…f008 ↗   Checker  0x5c6E…6AA8 ↗              │
│ Thời hạn trả lời  10 phút   Token  USDC 0x5425…Bc65 ↗          │
├──────────────────────────────────────────────────────────────┤
│ Tự kiểm trong 3 bước                                           │ SelfCheckSteps
│ 1. Tải repo         [git clone … && cd AskPay && npm ci]  [⧉] │
│ 2. Dựng lại corpus  [npm run corpus && git diff --exit-code packages/corpus/data] [⧉] │
│ 3. Đọc root on-chain [cast call 0x869e… "lawRoot(bytes32)(bytes32)" 0x… --rpc-url …] [⧉] │
│ Trang này chỉ so Merkle root. …                               │ ScopeNote
└──────────────────────────────────────────────────────────────┘
```

### 5.2 Nguồn dữ liệu: trang vẫn đọc được khi API sập

| Giá trị | Nguồn | Khi lỗi |
|---|---|---|
| `lawId` | `BLLD_2019_LAW_ID` của `@askpay/shared` | — (hằng) |
| Root trong repo | Hằng sinh ra lúc build từ đầu ra của `packages/corpus` (U-22) | — (hằng) |
| Root trên contract | **Trình duyệt tự đọc** `lawRoot(lawId)` qua viem, không qua API | "Không đọc được contract." + "Thử lại" |
| Tên luật, số Điều, số Khoản | Đề xuất cùng hằng ở U-22. Phương án B: `GET /api/corpus` | Phương án B lỗi thì hiện "—", phần còn lại không đổi |
| Escrow, token | `fujiDeployment` (shared, sinh từ `contracts/deployments/fuji.json`) | — |
| Provider, checker, thời hạn trả lời | Trình duyệt đọc `provider()`, `checker()`, `answerWindow()` | Hiện giá trị trong `fujiDeployment`, kèm "(theo file deployments, chưa đọc được từ contract)" |

- Trang không dùng `rootMatches` của `/api/corpus` để kết luận. Trình duyệt tự so `repoRoot === onChainRoot`, để người xem không phải tin máy chủ ở đúng bước họ đang kiểm.
- `GET /api/corpus` chỉ là nguồn phụ cho số đếm (phương án B).

### 5.3 Trạng thái của `LawCard`

| Trạng thái | Badge góc thẻ | Nội dung |
|---|---|---|
| Đang đọc chain | Skeleton | Root on-chain là skeleton |
| Khớp | ✓ KHỚP (tông `paid`, chữ `ink`, theo U-11) | "Root trong repo khớp root đã đăng ký trên contract." |
| Lệch | ✗ LỆCH (tông `refund`, chữ `ink`, icon `triangle-alert`) | "Root trong repo khác root trên contract. Bản luật trong repo không phải bản đã đăng ký." Hai root đầy đủ, xuống dòng được |
| Chưa đăng ký (`lawRoot = 0x0…0`) | CHƯA ĐĂNG KÝ (tông `expired`) | "Contract chưa có root cho bộ luật này." |
| Lỗi RPC | — | "Không đọc được contract." + "Thử lại". **Không** hiện ✓ hay ✗ |

- **Màu:** dùng `Badge` của W3. Không dùng `error` cho "Lệch": đây là kết luận, không phải lỗi hệ thống.
- **Câu chữ bị cấm** (spec §8):
  - "Đã xác minh trích dẫn"
  - "Blockchain kiểm đúng nguyên văn"
  - "Ai cũng kiểm được đoạn trích ngay trên trang /verify"
- Thông báo khớp chỉ nói về **root**.

### 5.4 `ContractCard`

- Mỗi địa chỉ dùng `Address` của W1: rút gọn, có `title` đầy đủ, link Snowtrace address, thêm nút sao chép như `AccountMenu`.
- Escrow có thêm chữ "mã nguồn trên Snowtrace". Contract đã verify (spec §8, system-design §8).
- **Provider và checker lệch file deployments:** hiện giá trị **on-chain**, kèm dòng `ink-muted` "Khác với `contracts/deployments/fuji.json` trong repo." Chain thắng; owner có thể đã gọi `setProvider`.
- Thời hạn trả lời: `answerWindow` (giây) đổi sang phút. `600` cho ra "10 phút". Không chia hết cho 60 thì ghi "{n} giây".
- Dòng giải thích dưới provider và checker: "Provider gửi tiền vào và chốt. Checker ký kết luận kiểm tra bằng khoá riêng. Ở v1 cả hai do AskPay vận hành." Câu cuối bắt buộc, vì spec §8 cấm nói "checker độc lập".

### 5.5 `SelfCheckSteps`

Ba bước, mỗi bước là một khối `<pre><code>` font mono, có nút "Sao chép". Sao chép xong thì đổi nhãn thành "Đã sao chép" trong 2 giây, kèm `aria-live`, giống W1 `AccountMenu`.

1. `git clone https://github.com/AkiraTomori/AskPay.git && cd AskPay && npm ci`. URL lấy từ `REPO_URL` (W4 U-18, repo public khi nộp).
2. `npm run corpus && git diff --exit-code packages/corpus/data`
   - Giải thích: "Lệnh này dựng lại corpus và Merkle root từ văn bản gốc trong repo. Không có thay đổi nào (`git diff` không in gì) nghĩa là root dựng lại đúng bằng root đã commit."
   - Thêm: "Root cũng được in ra ở dòng `root: 0x…`."
3. `cast call <escrow> "lawRoot(bytes32)(bytes32)" <lawId> --rpc-url <RPC>`
   - `<escrow>`, `<lawId>` và `<RPC>` được điền sẵn giá trị thật. `<RPC>` là RPC công khai của Fuji, lấy từ `RPC_URL` (U-10).
   - Giải thích: "Cần Foundry (`cast`). Kết quả phải bằng root ở bước 2."

**`ScopeNote`** (bắt buộc theo Q-13, `ink-muted`):
- "Trang này chỉ so Merkle root của bộ luật."
- "Để kiểm đoạn trích của một câu trả lời, dùng hàm `citationsHash()` trong `packages/shared` và so với `citationsHash` trong event `Paid` của tx chốt trên Snowtrace."

Câu này không đi kèm giao diện nào.

## 6. Cây file

| File | Vai trò |
|---|---|
| `app/verify/page.tsx` | Mỏng, render `<VerifyView />` |
| `features/verify/components/VerifyView.tsx`, `LawCard.tsx`, `ContractCard.tsx`, `SelfCheckSteps.tsx`, `CopyButton.tsx` | `CopyButton` đặt ở `components/ui` nếu dùng chung với `AccountMenu` (tách khỏi W1 trong cùng PR) |
| `features/verify/hooks.ts` | `useOnChainLaw()` (`lawRoot`), `useOnChainRoles()` (`provider`, `checker`, `answerWindow`). Đều `useReadContracts`, `chainId: 43113` |
| `features/verify/verify-view.ts` | Hàm thuần: kết luận khớp / lệch / chưa đăng ký / lỗi |
| `features/verify/messages.ts` | Chuỗi của §5 |
| `features/ask/components/ClaimRefundPanel.tsx` | §3.1 |
| `features/ask/claim.ts` | Hàm thuần: giải mã lỗi revert, nhận log `Refunded` hợp lệ từ receipt (§4) |
| `features/ask/hooks.ts` | Thêm `useClaimRefund(qid)`, `useOnChainQuestion(qid, enabled)` (§2.2) |
| `features/ask/result-view.ts` | Thêm nguồn chain và trạng thái tạm từ receipt vào `toResultView` |
| `components/question/status.ts` | Thêm `badgeOfChain` |
| `components/layout/nav-items.ts` | Thêm "Xác minh" (W1 U-02) |
| `lib/constants.ts` | Thêm `AVAX_FAUCET_URL` (U-24) |
| `packages/corpus` (U-22) | Script sinh thêm `data/blld-2019.meta.json`; package export `./meta` |

Theo convention, `features/verify` không import `features/ask`. Phần dùng chung (`Address`, `Badge`, `CopyButton`, `status.ts`) nằm ở `components/`.

## 7. A11y, bàn phím, responsive

- **Nút "Nhận lại tiền":** kiểu `primary`, nhãn đầy đủ. Đang chạy thì `aria-busy`, giữ nguyên kích thước (không nhảy bố cục). Mọi thông báo của luồng nhận lại tiền dùng một vùng `aria-live="polite"`.
- **Đếm ngược tới hạn** (§2.2): cập nhật mỗi giây nhưng **không** `aria-live`. Chỉ đọc một lần khi tới hạn: "Đã tới hạn, bạn có thể nhận lại tiền."
- **`/verify`:**
  - h1 "Tự xác minh", `document.title` "Tự xác minh · AskPay".
  - Thẻ là `<section>` có h2.
  - Hash dài: font mono, `break-all` trong khối đầy đủ, rút gọn ở hàng tóm tắt.
  - Khối lệnh cuộn ngang **bên trong** `<pre>` (`overflow-x-auto`, `tabindex="0"`, `aria-label` theo tên bước), để trang không cuộn ngang ở 360px.
- **Thứ tự Tab trên `/verify`:** sao chép lawId → sao chép hai root → link địa chỉ → khối lệnh và nút sao chép từng bước.
- Lighthouse a11y ≥ 90 trên `/verify` và trên trang kết quả ở trạng thái QUÁ HẠN.

## 8. Chuỗi giao diện (trích)

```
// features/ask/messages.ts (W5)
claimTitle: (amount) => `Bạn nhận lại được ${amount} USDC. Không cần máy chủ AskPay.`
claimToSelf: (addr) => `Tiền sẽ về ví của bạn (${addr}).`
claimToPayer: (addr) => `Tiền sẽ về ví ${addr} (ví đã hỏi câu này), không về ví đang kết nối.`
claimButton: 'Nhận lại tiền'   connectToClaim: 'Kết nối ví để nhận lại tiền'
claimGasNote: 'Phí gas trả bằng AVAX testnet từ ví đang kết nối.'
claimChecking: 'Đang kiểm tra…'   claimConfirm: 'Xác nhận trong ví…'
claimPending: 'Đang chờ blockchain xác nhận…'   claimSlow: 'Chưa xác nhận được. Xem tx trên Snowtrace.'
claimRejected: 'Bạn đã huỷ. Tiền vẫn nằm trong escrow.'
claimAlreadyClosed: 'Câu hỏi này vừa được chốt, không cần nhận lại.'
claimTxNotNeeded: 'Tx của bạn không cần nữa vì câu đã được chốt trước.'
claimNotYet: (s) => `Blockchain chưa tới hạn (lệch vài giây với máy chủ). Thử lại sau ${s} giây.`
claimNoGas: 'Ví chưa có AVAX testnet để trả phí gas.'   getTestAvax: 'Lấy AVAX testnet'
claimRpcFailed: 'Không kiểm tra được với blockchain. Thử lại.'
claimFailed: 'Không nhận lại được tiền lúc này. Tiền vẫn nằm trong escrow.'
claimTxLabel: 'Nhận lại tiền'
chainSourceTitle: 'Trạng thái đọc thẳng từ blockchain'
chainReading: 'Đang đọc trạng thái tiền từ blockchain…'
chainOpenNotYet: (hhmm) => `Máy chủ không phản hồi. Tiền vẫn nằm trong escrow. Bạn tự nhận lại được sau ${hhmm}.`
chainPaidNoContent: 'Máy chủ không phản hồi nên chưa hiện được câu trả lời.'
chainRefunded: 'Tiền đã được trả lại vào ví người hỏi.'
chainFailed: 'Không đọc được blockchain lúc này.'
deadlineReached: 'Đã tới hạn, bạn có thể nhận lại tiền.'
questionById: (short) => `Câu hỏi ${short}`

// features/verify/messages.ts
title: 'Tự xác minh'   intro: 'So bản luật trong repo với bản đã đăng ký trên blockchain.'
lawTitle: 'Bộ luật'   repoRoot: 'Root trong repo'   chainRoot: 'Root trên contract'
match: 'KHỚP'  mismatch: 'LỆCH'  unregistered: 'CHƯA ĐĂNG KÝ'
matchText: 'Root trong repo khớp root đã đăng ký trên contract.'
mismatchText: 'Root trong repo khác root trên contract. Bản luật trong repo không phải bản đã đăng ký.'
unregisteredText: 'Contract chưa có root cho bộ luật này.'
readFailed: 'Không đọc được contract.'   retry: 'Thử lại'
contractTitle: 'Contract'   escrow: 'Escrow'   sourceOnSnowtrace: 'mã nguồn trên Snowtrace'
provider: 'Provider'   checker: 'Checker'   answerWindow: 'Thời hạn trả lời'   token: 'Token'
rolesNote: 'Provider gửi tiền vào và chốt. Checker ký kết luận kiểm tra bằng khoá riêng. Ở v1 cả hai do AskPay vận hành.'
deploymentsFallback: '(theo file deployments, chưa đọc được từ contract)'
roleDiffers: 'Khác với contracts/deployments/fuji.json trong repo.'
stepsTitle: 'Tự kiểm trong 3 bước'
steps: ['Tải repo', 'Dựng lại corpus', 'Đọc root on-chain']
scopeNote: 'Trang này chỉ so Merkle root của bộ luật. Để kiểm đoạn trích của một câu trả lời, dùng hàm citationsHash() trong packages/shared và so với citationsHash trong event Paid của tx chốt trên Snowtrace.'
copy: 'Sao chép'   copied: 'Đã sao chép'
```

Nav: thêm `navVerify: 'Xác minh'` vào `lib/messages.ts`. Giữ test W3-E18: không chuỗi nào chứa "Đã xác minh".

## 9. Ví dụ chấp nhận

Test dùng Vitest + Testing Library, ví `mock` của wagmi (harness W1). Đọc contract giả bằng transport `custom` của viem trả kết quả `eth_call`, `eth_getBlockByNumber`, `eth_getTransactionReceipt` theo fixture.

| Mã | Cho / Khi / Thì | Kiểm bằng |
|---|---|---|
| W5-E01 (AP-06-AC03) | API `CLAIMABLE`, ví `ready` là `payer` → panel có "Tiền sẽ về ví của bạn (0xab…cd)." và nút "Nhận lại tiền" | Vitest |
| W5-E02 | Ví khác `payer` → câu "không về ví đang kết nối"; chưa kết nối → "Kết nối ví để nhận lại tiền" mở hộp thoại W1; sai mạng → "Chuyển sang Fuji" | Vitest |
| W5-E03 (AP-06-AC01) | Bấm → mô phỏng qua → `writeContract(claimRefund, [qid])` một lần → receipt có log `Refunded(qid, payer, 50000, Timeout)` từ escrow → badge ĐÃ HOÀN TIỀN, câu `REFUND_REASONS.TIMEOUT`, `TxLink` đúng hash, số dư được invalidate | Vitest |
| W5-E04 (system-design §5.6 E) | Mô phỏng revert `QuestionNotOpen` → **không** gọi `writeContract`, refetch, hiện trạng thái cuối, không có chữ màu `error` | Vitest |
| W5-E05 | Receipt `reverted` → không báo lỗi, refetch, dòng "Tx của bạn không cần nữa…" | Vitest |
| W5-E06 (AP-06-AC02) | Mô phỏng revert `DeadlineNotReached` → câu `notYet`, không mở ví; block mới vượt `deadline` → nút bật lại | Vitest |
| W5-E07 | Từ chối ký → về `idle`, "Bạn đã huỷ. Tiền vẫn nằm trong escrow."; thiếu AVAX → câu `claimNoGas` + link faucet | Vitest |
| W5-E08 | Receipt chưa có sau 60 giây → vẫn `pending`, "Chưa xác nhận được…", không có nút gửi lại | Vitest (fake timers) |
| W5-E09 | Receipt có log `Refunded` nhưng từ địa chỉ khác hoặc `qid` khác → **không** đổi sang ĐÃ HOÀN TIỀN | Vitest (đơn vị `claim.ts`) |
| W5-E10 (P5) | API trả lỗi mạng; chain: `Open`, `deadline` < block mới nhất → khối "Trạng thái đọc thẳng từ blockchain", h1 "Câu hỏi 0x…", badge QUÁ HẠN, nút Nhận lại tiền | Vitest |
| W5-E11 | API 404; chain `None` → "Không tìm thấy câu hỏi này." (không có khối chain); chain `Paid` → ĐÃ THANH TOÁN, không ✓, không thẻ | Vitest |
| W5-E12 | API `PENDING`, `createdAt` cách đây 11 phút; chain `Open` quá hạn → nút hiện (indexer lag) | Vitest |
| W5-E13 | Chain `Open` chưa tới hạn → câu "Bạn tự nhận lại được sau HH:mm" theo giờ Việt Nam, đếm ngược không có `aria-live` | Vitest |
| W5-E14 (AP-01-AC04) | `/verify`: root repo = root chain → ✓ KHỚP, câu khớp; lệch → ✗ LỆCH, hai root đầy đủ; `0x0…0` → CHƯA ĐĂNG KÝ; RPC lỗi → "Không đọc được contract." không ✓/✗ | Vitest |
| W5-E15 | `/verify` khi `/api/*` lỗi → root, contract, ba bước vẫn hiện; chỉ số Điều/Khoản là "—" (nếu dùng phương án B) | Vitest |
| W5-E16 | Provider on-chain khác `fujiDeployment.provider` → hiện giá trị on-chain + "Khác với contracts/deployments/fuji.json…" | Vitest |
| W5-E17 | Lệnh bước 3 chứa đúng `fujiDeployment.address`, `BLLD_2019_LAW_ID`, `RPC_URL`; "Sao chép" ghi đúng chuỗi vào clipboard, đổi nhãn 2 giây | Vitest |
| W5-E18 | Không chuỗi nào ở `features/verify/messages.ts` chứa "Đã xác minh", "kiểm đúng nguyên văn", "checker độc lập"; có `scopeNote` và `rolesNote` | Vitest |
| W5-E19 | Nav có "Xác minh", `aria-current` đúng trang | Vitest |
| W5-E20 | **Thật trên Fuji, chỉ đọc:** mở `/verify` → root on-chain bằng `0xda14ddb6…17a5` (root.txt); chạy đúng ba lệnh trên một máy sạch → `git diff` rỗng và `cast call` ra cùng root | Thủ công |
| W5-E21 | **Thật trên Fuji, có broadcast** ("Xong khi"): hỏi một câu → API dừng sau khi đã giữ tiền (U-25) → tắt API → chờ 10 phút → mở `/questions/<qid>` → khối chain, QUÁ HẠN → bấm Nhận lại tiền bằng Core → ĐÃ HOÀN TIỀN, USDC về ví → bật lại API, chờ indexer → trang hiện `REFUNDED · TIMEOUT` từ API. Ghi qid, tx deposit, tx `claimRefund` | Thủ công. **Cần owner duyệt broadcast trước**: mạng Fuji. Ví người hỏi ký EIP-3009 và gửi `claimRefund(qid)` trên `AskPayEscrow` `0x869e…dce0`. Ví provider gửi `deposit` |
| W5-E22 | Bàn phím, 360px (khối lệnh cuộn trong `<pre>`, trang không cuộn ngang), Lighthouse a11y ≥ 90 trên `/verify` và trang QUÁ HẠN | Thủ công |

## 10. Câu hỏi mở (owner chốt)

| Mã | Câu hỏi | Đề xuất |
|---|---|---|
| U-21 | Ngay sau khi `claimRefund` thành công, API còn lag. Có dùng receipt (log `Refunded` khớp escrow và `qid`) để hiện ĐÃ HOÀN TIỀN trước khi API cập nhật không? | **Có.** Đây là bằng chứng on-chain (P2, AP-07-AC03). Chỉ sống trong phiên trang. API cập nhật thì theo API |
| U-22 | `/verify` lấy "root trong repo" từ đâu để không phải tin máy chủ? | **`npm run corpus` sinh thêm `data/blld-2019.meta.json`** (`lawName`, `lawId`, `root`, `dieuCount`, `khoanCount`). `@askpay/corpus` export `./meta`; web import file nhỏ này lúc build. Đổi đầu ra của script corpus nên cần owner đồng ý. **Phương án B:** dùng `repoRoot` và số đếm của `GET /api/corpus` (không đổi corpus, nhưng root "trong repo" là bản của máy chủ và trang cần API) |
| U-23 | Khi API sập, trang kết quả đọc thẳng `questions(qid)` và hiện cả nút lẫn badge từ chain (§2.2). Đồng ý phạm vi này, kể cả nhánh "PENDING quá hạn theo đồng hồ máy" (#3)? | Đồng ý cả ba nguồn ở §2.1. Nhánh #3 rẻ (một lần đọc khi đã quá hạn) và phủ lúc indexer đứng |
| U-24 | Link xin AVAX testnet khi ví thiếu gas | `https://core.app/tools/testnet-faucet/` (faucet của Core, cùng ví đang dùng demo). Đặt `AVAX_FAUCET_URL` trong `lib/constants.ts`. Owner kiểm link còn sống |
| U-25 | **Dựng câu quá hạn để demo "server tắt → tự rút"** (W5-E21). API khởi động lại sẽ tự chốt câu đang mở (`ask.recovery`, §5.6 D), nên API phải tắt liên tục từ lúc giữ tiền tới lúc rút. Pipeline chỉ mất vài giây, tắt tay cho kịp là rủi ro | **Thêm cờ demo ở API** (giống `DEMO_FAKE_CITATION`): `DEMO_STALL=true` và câu bắt đầu bằng `#demo-stall` thì pipeline dừng sau `Deposited`, không trả lời, không chốt. Đây là thay đổi ở `apps/api` nên làm slice riêng nhỏ. **Phương án B** (không đổi mã): tắt API ngay sau khi ví ký; tx deposit đã vào mempool vẫn được mined. Chấp nhận có thể phải thử vài lần |
| U-26 | Ở chế độ chain, `Paid` mà API sập: chỉ hiện ĐÃ THANH TOÁN, không có câu trả lời và không có dấu ✓. Chấp nhận? | Chấp nhận. Câu trả lời và `verifiedOnChain` cần máy chủ; không hiện dấu nếu chưa có bằng chứng (AP-07-AC02) |

## 11. Ngoài phạm vi W5

- Nhận lại tiền cho nhiều câu cùng lúc.
- Danh sách "câu của tôi đang quá hạn" theo ví.
- Thông báo email hoặc đẩy.
- Giao diện kiểm `citationsHash` (Q-13).
- So từng Khoản hay dựng Merkle proof trên trình duyệt.
- Đọc event trực tiếp từ RPC để lấy lý do hoàn tiền khi API sập.
- Mainnet.
- Chế độ tối.
