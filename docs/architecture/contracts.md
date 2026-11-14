# 📜 AskPay — Contract Spec

> Đặc tả Solidity cho `AskPayEscrow`. **Đây là nguồn duy nhất cho chữ ký hàm, error và event.** Đổi chữ ký hàm thì sửa file này trước, chạy `npm run abi` để sinh lại ABI vào `packages/shared`, rồi sửa mọi chỗ TypeScript báo lỗi.
>
> **Trạng thái:** spec, chưa có code. Các mục đánh dấu ❓ cần chốt khi làm slice contract (11/11). Quy tắc viết code ở [`../conventions/contracts.md`](../conventions/contracts.md).

---

## 1. Vai trò và quyền

| Vai trò | Là gì | Được làm |
|---|---|---|
| `owner` | Ví của Akira (`Ownable`) | `setLawRoot`, `setProvider`, `setChecker`, `setAnswerWindow`. **Không** rút được tiền đang giữ (P1). |
| `provider` | Ví server AskPay | `deposit`, `settle`, `refundByProvider`. Nhận tiền khi Paid. |
| `checker` | Khoá ký verdict (không cần AVAX, không gửi tx) | Chỉ ký EIP-712 off-chain |
| Người hỏi (`payer`) | Ví bất kỳ | Ký uỷ quyền EIP-3009 off-chain; gọi `claimRefund` khi quá hạn |
| Bất kỳ ai | — | Đọc trạng thái; gọi `claimRefund` (tiền vẫn chỉ về đúng `payer`) |

- ❓ `provider` và `owner` có thể là cùng một ví cho demo. **`checker` bắt buộc khác `provider`**: constructor và `setChecker` revert nếu trùng.

## 2. Storage

```solidity
enum Status { None, Open, Paid, Refunded }

enum RefundReason { None, NoCitation, InvalidCitation, CheckerRejected, AnswerFailed, Timeout }

struct Question {
    address payer;
    uint96  amount;      // đơn vị nhỏ nhất của token (USDC: 6 số lẻ)
    uint64  deadline;    // unix giây; sau mốc này ai cũng claimRefund được
    Status  status;
}

struct Citation {
    bytes32 lawId;
    uint16  dieu;
    uint16  khoan;       // 0 nếu Điều không chia Khoản
    bytes32 textHash;    // keccak256(bytes(nguyên văn Khoản đã chuẩn hoá))
    bytes32 quoteHash;   // keccak256(bytes(đoạn trích đã chuẩn hoá)); KHÔNG nằm trong leaf (§4.3)
}

IERC3009 public immutable token;
address  public provider;
address  public checker;
uint64   public answerWindow;                    // mặc định 10 phút (Q-07)
mapping(bytes32 lawId => bytes32 root) public lawRoot;
mapping(bytes32 qid   => Question)      public questions;

uint8 public constant MAX_CITATIONS = 5;
```

- `uint96` đủ chứa 79 tỉ token có 18 số lẻ; với USDC thì thừa. Gói `payer + amount` vào một slot.
- `IERC3009` là interface tối thiểu: `receiveWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)` và `transfer`.

## 3. Hàm

| Hàm | Ai gọi | Mô tả |
|---|---|---|
| `constructor(IERC3009 token, address provider, address checker, uint64 answerWindow)` | deploy | `checker != provider`, khác 0 |
| `setLawRoot(bytes32 lawId, bytes32 root)` | owner | Emit `LawRootSet`. ❓ cho ghi đè hay không: đề xuất **không**, mỗi phiên bản luật một `lawId` mới |
| `setProvider(address)`, `setChecker(address)`, `setAnswerWindow(uint64)` | owner | Chỉ ảnh hưởng câu hỏi **mới** |
| `deposit(bytes32 qid, address payer, uint256 amount, uint256 validAfter, uint256 validBefore, uint8 v, bytes32 r, bytes32 s)` | provider | Xem §4.1 |
| `settle(bytes32 qid, bytes32 answerHash, Citation[] calldata citations, bytes32[][] calldata proofs, bool pass, bytes calldata checkerSig)` | provider | Xem §4.2 |
| `refundByProvider(bytes32 qid)` | provider | Hoàn tiền lý do `AnswerFailed` cho mọi ca server tự hoàn: LLM lỗi, checker lỗi, `settle` lỗi, sắp tới hạn (§4.2b). Provider luôn được tự hoàn tiền vì chỉ thiệt cho chính nó. |
| `claimRefund(bytes32 qid)` | bất kỳ ai | `status == Open` và `block.timestamp > deadline` → hoàn tiền lý do `Timeout` |
| `verdictDigest(bytes32 qid, bytes32 answerHash, bytes32 citationsHash, bool pass) → bytes32` | view | Digest EIP-712 để server ký và test đối chiếu |
| `citationsHashOf(Citation[] calldata) → bytes32` | pure | `keccak256(abi.encode(citations))`, giống `citationsHash()` trong `packages/shared` (§4.4) |
| `leafOf(Citation) → bytes32` | pure | Giống công thức trong `packages/shared`. Bỏ qua `quoteHash`. |

Không có hàm `withdraw`, không có tham số `recipient`.

## 4. Logic chi tiết

### 4.1 `deposit`

| Thứ tự | Kiểm | Error |
|---|---|---|
| 1 | `msg.sender == provider` | `NotProvider()` |
| 2 | `questions[qid].status == None` | `QuestionExists(qid)` |
| 3 | `amount > 0` và `amount <= type(uint96).max` | `InvalidAmount()` |
| 4 | Gọi `token.receiveWithAuthorization(payer, address(this), amount, validAfter, validBefore, qid, v, r, s)`. **`nonce` là chính `qid`.** | Lỗi của token được giữ nguyên (sai chữ ký, hết hạn, nonce đã dùng) |
| 5 | Ghi `Question{payer, amount, now + answerWindow, Open}` | — |
| 6 | Emit `Deposited(qid, payer, amount, deadline)` | — |

Ghi chú: bước 4 đứng trước bước 5 vì token là contract tin cậy (USDC). Hàm có `nonReentrant` để phòng token giả trong test.

### 4.2 `settle`

```
citationsHash = keccak256(abi.encode(citations))   // Citation[] gồm cả quoteHash; mã hoá chính xác ở §4.4
digest = _hashTypedDataV4(keccak256(abi.encode(VERDICT_TYPEHASH, qid, answerHash, citationsHash, pass)))
VERDICT_TYPEHASH = keccak256("Verdict(bytes32 qid,bytes32 answerHash,bytes32 citationsHash,bool pass)")
EIP-712 domain: name "AskPayEscrow", version "1", chainId, verifyingContract
```

| Thứ tự | Kiểm | Kết quả |
|---|---|---|
| 1 | `msg.sender == provider` | revert `NotProvider()` |
| 2 | `status == Open` | revert `QuestionNotOpen(qid)` |
| 3 | `citations.length <= MAX_CITATIONS`, `proofs.length == citations.length` | revert `BadCitations()` |
| 4 | `citations.length == 0` | **Refunded**, `NoCitation`. Không cần chữ ký. |
| 5 | `ECDSA.recover(digest, checkerSig) == checker` | revert `InvalidCheckerSignature()`. Tiền vẫn giữ (AP-05-AC05). |
| 6 | Mọi `i`: `lawRoot[c.lawId] != 0` và `MerkleProof.verifyCalldata(proofs[i], lawRoot[c.lawId], leafOf(c))` | Một proof sai → **Refunded**, `InvalidCitation` |
| 7 | `pass == false` | **Refunded**, `CheckerRejected` |
| 8 | Còn lại | **Paid**: `token.transfer(provider, amount)`, emit `Paid(qid, provider, amount, answerHash, citationsHash)` |

- Bước 6 đứng **sau** kiểm chữ ký, để không ai dùng proof sai cộng chữ ký giả mà ép được hoàn tiền. Thực ra hoàn tiền về đúng người hỏi nên không gây hại, nhưng đặt thứ tự này cho dễ lý luận.
- Thứ tự bên trong khi chuyển tiền: đặt `status` trước, rồi `transfer` (checks-effects-interactions), có `nonReentrant`.
- `settle` vẫn chạy được sau `deadline` nếu chưa ai `claimRefund` (không bất lợi cho người hỏi: chưa chốt thì tiền vẫn đó).

### 4.2b `refundByProvider` và `claimRefund`

Cả hai đều `nonReentrant`, đặt `status` trước rồi mới `transfer` (checks-effects-interactions). Tiền chỉ về `payer` (P1).

| Hàm | Thứ tự | Kiểm | Kết quả |
|---|---|---|---|
| `refundByProvider` | 1 | `msg.sender == provider` | revert `NotProvider()` |
| | 2 | `status == Open` | revert `QuestionNotOpen(qid)` |
| | 3 | Không kiểm `deadline`: provider được hoàn tiền cả trước lẫn sau hạn | **Refunded**, `token.transfer(payer, amount)`, emit `Refunded(qid, payer, amount, AnswerFailed)` |
| `claimRefund` | 1 | `status == Open` | revert `QuestionNotOpen(qid)` |
| | 2 | `block.timestamp > deadline` | revert `DeadlineNotReached(qid, deadline)` |
| | 3 | Ai gọi cũng được | **Refunded**, `token.transfer(payer, amount)`, emit `Refunded(qid, payer, amount, Timeout)` |

- Server dùng `refundByProvider` cho mọi ca tự hoàn tiền: LLM lỗi, checker lỗi, `settle` lỗi tất định, sắp tới hạn, khởi động lại ([system-design §5.6](./system-design.md)). Ở v1 các ca này dùng chung lý do `AnswerFailed`; không thêm tham số lý do.
- Sau `deadline`, `settle`, `refundByProvider` và `claimRefund` đều có thể đua nhau. Tx nào mined trước thì thắng, hai tx còn lại revert `QuestionNotOpen`. Tiền không bao giờ ra hai lần (bất biến 2 và 3).

### 4.3 Leaf

```solidity
function leafOf(Citation calldata c) public pure returns (bytes32) {
    return keccak256(bytes.concat(keccak256(abi.encode(c.lawId, c.dieu, c.khoan, c.textHash))));
}
```

Khớp `StandardMerkleTree.of(values, ["bytes32","uint16","uint16","bytes32"])` của `@openzeppelin/merkle-tree`. Test chéo bằng một fixture JSON sinh từ TypeScript.

Leaf **cố ý không chứa `quoteHash`**. Cây Merkle mô tả corpus, còn đoạn trích thay đổi theo từng câu trả lời. Thêm `quoteHash` vào `Citation` vì thế không đổi root và không phải đăng ký lại.

### 4.4 Cam kết đoạn trích (`citationsHash`)

Vấn đề cần giải quyết: trước đây, đoạn trích người dùng thấy cạnh dấu "✓ Đã xác minh on-chain" không nằm trong chữ ký checker, không nằm trong calldata và cũng không có trong event nào. Sau khi chốt, server đổi đoạn trích thì không ai phát hiện được.

**Mã hoá chính xác.** Hai phía phải cho ra cùng một byte:

| Phía | Cách tính |
|---|---|
| Solidity | `keccak256(abi.encode(citations))`, với `citations` có kiểu `Citation[]`, tức `tuple(bytes32,uint16,uint16,bytes32,bytes32)[]` |
| TypeScript (`packages/shared`, hàm `citationsHash()`) | `keccak256(encodeAbiParameters([{ type: 'tuple[]', components: [lawId bytes32, dieu uint16, khoan uint16, textHash bytes32, quoteHash bytes32] }], [citations]))` |

- **Thứ tự trích dẫn có nghĩa.** Hai danh sách khác thứ tự cho ra hai hash khác nhau. Thứ tự là thứ tự LLM trả về và được giữ nguyên tới lúc hiển thị.
- `quoteHash = keccak256(utf8(normalizeText(quote)))`. `normalizeText` dùng chung với corpus (NFC, gộp khoảng trắng, bỏ khoảng trắng đầu và cuối, §6 của system-design). Chuỗi đã chuẩn hoá này là chuỗi được lưu và hiển thị.
- Danh sách rỗng vẫn có hash, nhưng không dùng tới: bước 4 hoàn tiền trước khi kiểm chữ ký.

**Cam kết gì, không cam kết gì.**

| Điều | Ai bảo đảm |
|---|---|
| Khoản `(lawId, dieu, khoan, textHash)` có trong văn bản đã đăng ký | Contract (Merkle proof) |
| Đoạn trích có hash `quoteHash` là đoạn checker đã duyệt ở bước C2 | Chữ ký checker trên `citationsHash` |
| Đoạn trích hiển thị sau khi chốt đúng là đoạn đã duyệt | Kiểm được bằng `citationsHash()` của `packages/shared`: băm lại đoạn trích, so với `citationsHash` trong event `Paid`. Server tự làm bước này với log đọc qua RPC; v1 không có giao diện cho người ngoài (spec Q-13). |
| Đoạn trích nằm trong nguyên văn Khoản | **Chỉ checker** (off-chain). Contract không kiểm chuỗi con. |

## 5. Event

```solidity
event LawRootSet(bytes32 indexed lawId, bytes32 root);
event Deposited(bytes32 indexed qid, address indexed payer, uint256 amount, uint64 deadline);
event Paid(bytes32 indexed qid, address indexed provider, uint256 amount, bytes32 answerHash, bytes32 citationsHash);
event Refunded(bytes32 indexed qid, address indexed payer, uint256 amount, RefundReason reason);
event ProviderSet(address provider);
event CheckerSet(address checker);
```

## 6. Error → mã lý do → câu tiếng Việt

Bảng câu tiếng Việt nằm trong `packages/shared/src/errors.ts`. UI chỉ lấy câu từ đó.

| Nguồn | Mã | Câu hiển thị |
|---|---|---|
| `RefundReason.NoCitation` | `NO_CITATION` | Câu trả lời không có trích dẫn nên bạn không phải trả tiền. |
| `RefundReason.InvalidCitation` | `INVALID_CITATION` | Trích dẫn không khớp văn bản luật đã đăng ký trên blockchain, đã hoàn tiền. |
| `RefundReason.CheckerRejected` | `CHECKER_REJECTED` | Trích dẫn không đúng nguyên văn hoặc không liên quan tới câu hỏi, đã hoàn tiền. |
| `RefundReason.AnswerFailed` | `ANSWER_FAILED` | Hệ thống không trả lời được lúc này, đã hoàn tiền. |
| `RefundReason.Timeout` | `TIMEOUT` | Quá thời hạn trả lời, tiền đã được trả lại. |
| `QuestionExists` | `QUESTION_ALREADY_SETTLED` | Câu hỏi này đã được thanh toán trước đó. |
| `QuestionNotOpen` | `QUESTION_ALREADY_SETTLED` | Câu hỏi này đã được chốt. |
| `DeadlineNotReached` | `REFUND_NOT_YET` | Chưa tới hạn tự nhận lại tiền. |
| `InvalidCheckerSignature`, `BadCitations` | `INTERNAL_ERROR` | Lỗi hệ thống (không hiện chi tiết cho người dùng). Server bắt được khi mô phỏng, rồi chuyển sang `refundByProvider`. |
| `NotProvider`, `InvalidAmount` | `INTERNAL_ERROR` | Lỗi cấu hình server. Không hiện chi tiết. |

## 7. Test (Foundry)

**Bất biến** (invariant test với handler gọi ngẫu nhiên `deposit`, `settle`, `refundByProvider`, `claimRefund`, `vm.warp`):

1. `token.balanceOf(escrow) == Σ amount của các câu Open + donated`.
   - `donated` là tổng token mà handler cố ý chuyển thẳng vào contract, không qua `deposit`. Ngoài đời ai cũng làm được việc đó, và số dư thừa này không thuộc câu nào, không rút được.
   - Giữ dấu `==` để vẫn bắt được lỗi kế toán làm thừa hoặc thiếu tiền trong escrow.
2. Một `qid` chỉ đi `None → Open → {Paid | Refunded}`; không quay lui.
3. Tiền ra khỏi escrow chỉ tới `payer` của chính câu đó hoặc `provider`.
4. Câu `Open` quá `deadline` luôn `claimRefund` thành công.
5. `Paid` chỉ xảy ra khi có chữ ký của `checker` với `pass = true` và mọi proof hợp lệ. `citationsHash` trong event `Paid` bằng đúng `citationsHash` mà checker đã ký.

**Ca cụ thể** (tên theo [`../conventions/contracts.md` §4](../conventions/contracts.md)):

| Test | Tiêu chí |
|---|---|
| `test_AP03_AC01_depositPullsExactAmount` | AP-03-AC01 |
| `testRevert_AP03_AC02_wrongSignature` / `_expired` / `_wrongNonce` | AP-03-AC02 |
| `testRevert_AP03_AC03_replaySameQid` | AP-03-AC03 |
| `testRevert_AP03_frontrunReceiveByOthers` | Mối đe doạ #5 |
| `test_AP05_AC01_validCitationsPayProvider` | AP-05-AC01 |
| `test_AP05_AC02_noCitationRefunds` | AP-05-AC02 |
| `test_AP05_AC03_oneBadProofRefundsAll` | AP-05-AC03 |
| `test_AP05_AC04_checkerRejectRefunds` | AP-05-AC04 |
| `testRevert_AP05_AC05_forgedChecker` / `_sigForOtherQid` / `_providerSignsOwnVerdict` | AP-05-AC05 |
| `testRevert_AP05_AC05_quoteHashChangedAfterSign` / `_citationsReordered` | AP-05-AC05 (§4.4) |
| `test_AP05_AC01_paidEventCarriesSignedCitationsHash` | AP-05-AC01 (§4.4) |
| `testRevert_AP05_AC06_settleTwice` | AP-05-AC06 |
| `test_AP06_AC01_claimAfterDeadline`, `testRevert_AP06_AC02_claimBeforeDeadline` | AP-06 |
| `test_AP04_AC04_refundByProviderBeforeAndAfterDeadline`, `testRevert_refundByProvider_notProvider` / `_notOpen` | AP-04-AC04, §4.2b |
| `testRevert_AP06_AC02_claimAfterSettle`, `testRevert_settleAfterClaim` | §4.2b (đua sau `deadline`) |
| `test_leafMatchesTypeScriptFixture`, `test_leafIgnoresQuoteHash` | AP-01-AC04 |
| `test_citationsHashMatchesTypeScriptFixture` (gồm Khoản 0, chữ có dấu, 1 và 5 trích dẫn) | POC-2 |
| `testFuzz_amountAndTime` | Số tiền, thời gian ngẫu nhiên |

Token trong test: `MockUSDC` có EIP-3009 (copy tối thiểu từ FiatTokenV2), đặt ở `contracts/test/helpers/`.

## 8. Deploy

1. `forge script script/Deploy.s.sol --rpc-url fuji --account askpay-owner --broadcast --verify` (cần owner duyệt).
2. Ghi `address`, `deploymentBlock`, `token`, `provider`, `checker`, `answerWindow` vào `contracts/deployments/fuji.json`.
3. `forge script script/RegisterLawRoot.s.sol …` đọc `packages/corpus/data/blld-2019.root.txt` (cần owner duyệt).
4. `npm run abi`: sinh `packages/shared/src/abi/askPayEscrow.ts` và `deployments.ts`.
5. Kiểm: `GET /api/corpus` trả `rootMatches: true`.

## 9. Mở rộng (chỉ làm khi dư thời gian sau 18/11)

- `depositFor`: người hỏi tự gọi deposit, không cần provider gửi tx thay.
- Nhiều checker, cần chữ ký k-trên-n.
- Phí nền tảng tách riêng khỏi tiền provider.
