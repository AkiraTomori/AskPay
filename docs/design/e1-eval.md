# E1 — Bộ eval 50 câu và `npm run eval`

> **Trạng thái:** owner đã duyệt (20/11/2026): lấy **đề xuất** của U-27…U-34 ở §10 làm quyết định. **Nhãn Điều/Khoản của bộ 50 câu (`eval/questions.json`) owner đã xem và duyệt ngày 20/11/2026** (sau khi áp dụng các chỉnh sửa A–D: thu hẹp nhãn nv-03, nv-04, lg-10; thêm Đ42 K5 cho nv-06; thay 6 câu dễ bằng câu khó hơn; không thêm câu gõ không dấu). Trường `reviewed` đã điền. Ticket E1 ([tasks.csv](../runbook/tasks.csv)), hạn gốc 18/11, P0. Phụ thuộc A5 (đã xong). Chặn O1 (README cần số liệu).
>
> **Nguồn:**
> - Spec AP-09-AC01…AC03, AP-04-AC03, AP-05-AC04. Owner đã nói không cắt việc lúc này.
> - [system-design §5.2–§5.4](../architecture/system-design.md) (retrieval, answer, checker) và T-05 ("chỉ thêm embedding nếu eval < 70% đúng Khoản").
> - [api.md `GET /stats`](../architecture/api.md) và `evalSummarySchema` trong `packages/shared/src/api.ts` (dashboard W4 đã đọc file kết quả).
> - Spec Q-01 (Groq, `qwen/qwen3.8-27b`, hạn mức 8.000 token/phút và 1.000 yêu cầu/ngày).
>
> Tài liệu này không đổi hành vi, contract hay API. Nó chốt **định nghĩa ba con số**, cách chạy và định dạng đầu ra. Spec để ngỏ ba chỗ (mẫu số, thế nào là "đúng", câu nào tính), nên §4 là phần cần owner đọc kỹ nhất.

## 1. Mục tiêu và phạm vi

- **Ai dùng:** owner (số liệu cho README, slide, video), ban giám khảo (qua `/dashboard`, ô "Chất lượng").
- **Kết quả cần có:**
  - Một lệnh `npm run eval` chạy ~50 câu qua **đúng pipeline thật** (retrieval → answer → checker) và ghi ba số.
  - `eval/results/latest.json` mà dashboard đọc được (AP-09-AC03).
  - Số đo bằng **model đang chạy thật** (Q-01), không phải model miễn phí khác.
- **Không thuộc E1:**
  - Embedding hay đổi retrieval (T-05 chỉ nói *nếu* eval < 70%; đó là việc khác, và là mục 5 của plan §7).
  - Chạy lặp nhiều lần lấy trung bình, benchmark lớn (plan §2: "Để sau").
  - Tự sửa README. Owner chép số vào (§6).
  - Đụng `ask.pipeline.ts`, chain, SQLite.

## 2. Luồng chạy

```
questions.json ──► với mỗi câu:
  retrieve(question)            apps/api retrieval.service   (BM25, top-8)
  answer.answer(...)            apps/api answer.service      (LLM thật)
     noBasis hoặc 0 trích dẫn → dừng, kết quả "no-citation"   (như pipeline: C1)
  corpus.find(dieu, khoan)      → dựng CheckInput (textHash thật)
  checker.check(...)            apps/api checker.service     (C2, C3, C4 thật, LLM thật)
  ──► ghi kết quả từng câu ──► tính 3 số ──► latest.json
```

Chỉ định runner **phản chiếu `ask.pipeline.ts` dòng 259–311** (retrieve → answer → C1 → `corpus.find` → checker). Không import `payment`, không có chain, không có SQLite, không có qid thật.

- **Chữ ký:** checker cần một `VerdictSigner`. Runner sinh **khoá tạm** bằng `generatePrivateKey()` (như `scripts/check-live.mjs`). Chữ ký không ảnh hưởng số đo. **Khoá `CHECKER_PRIVATE_KEY` thật không bao giờ được nạp**: runner chỉ đọc `.env.poc` (chỉ có khoá LLM), không đọc `apps/api/.env`.
- **Không chạm `#demo-`:** cờ demo không bật, và validator cấm câu hỏi bắt đầu bằng `#demo-` (§3).
- **Lệch pipeline là rủi ro đã biết:** bản sao có thể trôi so với `ask.pipeline.ts`. Cách bền hơn là tách `answerAndCheck()` dùng chung, nhưng file đó đang có thay đổi W5 chưa commit, nên E1 **không** sửa nó. Ghi lại làm việc sau (§11). Bù lại: test dùng LLM giả để khoá hành vi của runner (§8), và comment ở runner trỏ tới đúng dòng pipeline.

## 3. Bộ câu hỏi `eval/questions.json`

### 3.1 Định dạng

```jsonc
{
  "reviewed": null,   // owner điền {"by": "owner", "at": "2026-11-2x"} sau khi xác nhận nhãn
  "questions": [
    { "id": "tv-01", "group": "thu-viec", "question": "…", "gold": [{ "dieu": 25, "khoan": 1 }] },
    { "id": "ngoai-03", "group": "ngoai-pham-vi", "question": "…", "gold": [] }
  ]
}
```

- `group` thuộc đúng 5 giá trị: `thu-viec`, `lam-them-gio`, `nghi-viec`, `luong`, `ngoai-pham-vi` (AP-09-AC01).
- `gold` là **tập các `(dieu, khoan)` chấp nhận được** (một câu có thể có nhiều Khoản đúng). `khoan = 0` cho Điều không chia Khoản, giống `RetrievalDoc`. Câu ngoài phạm vi có `gold: []`.
- **Cỡ đề xuất:** 50 câu = 10 mỗi nhóm (40 trong phạm vi, 10 ngoài phạm vi). Một câu ngoài phạm vi chiếm 10% con số thứ ba, một câu trong phạm vi chiếm 2,5%. Nói rõ điều này khi đưa số lên slide.

### 3.2 Validator (hàm thuần, có test)

Fail nếu:
- Số câu ngoài khoảng 45–55, hoặc một nhóm dưới 5 câu.
- `id` trùng; `group` ngoài 5 giá trị.
- Câu trong phạm vi có `gold` rỗng; câu ngoài phạm vi có `gold` không rỗng.
- Bất kỳ `(dieu, khoan)` nào **không có trong corpus** (đối chiếu `blld-2019.khoan.json`).
- Câu hỏi trùng nhau (sau `normalizeText`), rỗng, hoặc bắt đầu bằng `#demo-`.

### 3.3 Quy trình gán nhãn (U-27: quyết định của owner)

AP-09-AC01 ghi "do owner gán". Vì vậy:
1. Agent **soạn nháp** câu hỏi và đề xuất `gold` bằng cách **đọc nguyên văn corpus**, **không** dùng retrieval hay LLM của hệ thống để chọn nhãn (nếu không, nhãn sẽ thiên về đúng thứ hệ thống tìm ra).
2. Câu hỏi viết như người dùng thật, không chép nguyên câu chữ của Khoản. Không dùng lại các câu đã dùng để chỉnh prompt (POC-3, `answer-live`, `check-live`, `judge-injection`), vì chúng làm số đẹp giả.
3. Owner xem từng câu và nhãn, sửa, rồi điền `reviewed`. *(Đã xong 20/11/2026.)* **Chưa có `reviewed` thì kết quả không bao giờ được ghi vào `latest.json`** (§5). Nhãn do agent đề xuất không được trình bày như nhãn cuối.

## 4. Định nghĩa ba con số

Mỗi câu chạy xong có đúng một **kết quả** (outcome):

| Outcome | Nghĩa |
|---|---|
| `answer-failed` | `answer.service` trả `failed` (sau một lần thử lại): ở production sẽ hoàn `ANSWER_FAILED` |
| `no-basis` | `noBasis = true` (không trích dẫn) |
| `no-citation` | `noBasis = false` nhưng 0 trích dẫn hợp lệ: ở production là `NO_CITATION` |
| `checker-failed` | checker trả `failed` (C4 không chấm được hoặc không ký được) |
| `rejected` (kèm `C2`/`C3`/`C4`) | checker ký `pass = false` |
| `passed` | checker ký `pass = true` |
| `infra` | **hết lượt thử lại do rate limit (429)** của eval, không phải lỗi của model (§5) |

Câu `infra` bị **loại khỏi mọi mẫu số** và được đếm riêng; còn `infra` thì lần chạy không được xuất bản (§5). Mọi outcome còn lại tính vào mẫu số.

| Số (khoá trong `latest.json`) | Mẫu số | Tính là đúng | Ghi chú |
|---|---|---|---|
| **Trích dẫn đúng Khoản** (`citationAccuracy`) | Câu **trong phạm vi** | Có **ít nhất một** trích dẫn `(dieu, khoan)` thuộc `gold` của câu đó | `answer-failed`, `no-basis`, `no-citation`, `checker-failed` đều tính là **sai** (người dùng không nhận được gì đúng). Tính trước checker: câu bị checker từ chối vẫn có thể "trích đúng". |
| **Đạt checker** (`checkerPassRate`) | Câu **trong phạm vi** | Outcome `passed` | Câu ngoài phạm vi không vào mẫu số vì chúng dừng ở C1 và kéo tỉ lệ xuống oan. `answer-failed`, `checker-failed`, `no-citation` đều tính là **không đạt** và có số đếm riêng. |
| **Ngoài phạm vi đúng** (`outOfScopeCorrect`) | Câu **ngoài phạm vi** | `noBasis === true` **chặt** | Chọn chặt vì AP-04-AC03 quy định câu mẫu "Không tìm thấy căn cứ…" chỉ khi `noBasis`. `no-citation` (model vẫn viết câu trả lời nhưng không trích) tuy bị hoàn tiền nhưng **không** phải "nói đúng là không có căn cứ", nên là sai. Khớp `answer-live`. |

Hai điều phải nói rõ khi trình bày:
- **Đạt checker ≠ đúng.** Một câu trả lời trích sai Khoản nhưng đoạn trích đúng nguyên văn và Khoản "liên quan" vẫn `passed`. Hai số đo hai thứ khác nhau; đừng gộp.
- **Một lần chạy.** Temperature 0 nhưng LLM không tất định tuyệt đối. Số là của một lần chạy, có ngày và commit.

**Số phụ** (nằm trong cùng file, dashboard bỏ qua, không phải số chính của AP-09-AC02):
- `retrievalRecall`: tỉ lệ câu trong phạm vi mà top-8 chứa ít nhất một `gold`. Không gọi LLM. Dùng để biết **lỗi nằm ở retrieval hay ở LLM**; đây mới là căn cứ nên (hay không nên) nghĩ tới embedding.
- `citationPrecision`: tỉ lệ trích dẫn (trên mọi câu trong phạm vi có trích dẫn) thuộc `gold`.
- Đếm theo outcome, theo nhóm, và danh sách từng câu (id, nhóm, outcome, các `(dieu, khoan)` đã trích, đúng/sai). **Không** lưu nguyên văn câu trả lời.

**Ngưỡng T-05 (U-31):** "eval < 70% đúng Khoản" áp dụng cho **`citationAccuracy`** (số chính ở trên). Nếu dưới 70%, báo owner kèm `retrievalRecall` để phân biệt. Không tự thêm embedding.

## 5. Chạy với Groq: nhịp, lỗi, chạy lại

**Model (U-29).** Mặc định `LLM_PROVIDER=groq`, `LLM_MODEL=qwen/qwen3.8-27b` (Q-01). Chạy với cấu hình khác thì chỉ được ghi `eval/results/draft.json`, không bao giờ `latest.json`. Cả provider và model được ghi vào kết quả.

**Hạn mức.** 8.000 token/phút (~3–4 câu/phút) và 1.000 yêu cầu/ngày. Một lần chạy 50 câu dùng ~100–150 yêu cầu (answer + judge, cộng thử lại), ước tính **15–20 phút**. Key Groq **dùng chung với API chạy thật**, nên:
- Không chạy eval gần lúc quay video hay Demo Day.
- Một ngày chỉ nên chạy tối đa vài lần đầy đủ (ước tính ~6, trước khi tính lưu lượng khác).

**Nhịp và 429.** Runner bọc `LlmClient` (cùng kiểu `trackLlmHealth`), không sửa `shared/llm.ts`:
- Giãn cách giữa các câu mặc định 20 giây (`EVAL_PACE_MS`; đề xuất, chỉnh khi đo thực tế).
- Gặp `LlmError('rate-limited')` thì chờ rồi thử lại **cùng cuộc gọi**: 15 → 30 → 60 giây, tối đa 3 lần. Service ở trên không thấy lỗi này.
- Hết lượt thử lại thì cuộc gọi lỗi như bình thường, nhưng bọc đã ghi cờ cho câu đó, và runner phân loại câu là `infra` chứ **không** là `answer-failed` hay `checker-failed`. Phân biệt này là điều giữ số đo sạch: rate limit của eval không phải chất lượng của model.

**Chạy dở và chạy lại.** Sau mỗi câu xong (không phải `infra`), runner ghi vào `eval/results/.checkpoint.json` (gitignore). Lần chạy sau tự dùng lại các câu đã xong nếu khoá khớp: `provider + model + hash(questions.json) + hash(prompt answer + prompt judge) + corpus root`. Khoá lệch thì bỏ checkpoint. `npm run eval -- --fresh` xoá checkpoint. **Lần chạy chốt số cho README phải dùng `--fresh`**, để cả bộ số đo trong một lần chạy liền mạch.

**Kết thúc:**

| Tình huống | Hành vi | Exit |
|---|---|---|
| Đủ 50 câu, không `infra`, nhãn đã `reviewed`, model đúng Q-01 | Ghi `latest.json` (`status: "final"`) | 0 |
| Còn câu `infra` | Ghi `draft.json` (`status: "incomplete"`), nêu câu nào, nói chạy lại để hoàn thành | 2 |
| `reviewed` rỗng | Ghi `draft.json` (`status: "labels-unconfirmed"`) | 3 |
| Model/provider khác Q-01 | Ghi `draft.json` (`status: "non-production-model"`) | 3 |
| `questions.json` không qua validator | Không gọi LLM, in lỗi | 1 |
| Thiếu khoá LLM | In thông báo, không gửi gì | 1 |

`latest.json` chỉ bị ghi đè khi lần chạy mới `final`; lần hỏng không làm mất kết quả cũ. `draft.json` cũng gitignore.

## 6. Đầu ra và AP-09-AC03

`eval/results/latest.json` **phải qua `evalSummarySchema`**, nếu không `history.service` im lặng trả `eval: null` và ô "Chất lượng" biến mất mà không có lỗi. Một file, hai tầng: 5 khoá của schema ở ngoài cùng, phần còn lại là khoá phụ (schema `z.object` bỏ khoá lạ, nên không hỏng).

```jsonc
{
  "runAt": "2026-11-20",            // ngày chạy (UTC)
  "commit": "345f9e7",              // git rev-parse --short HEAD
  "citationAccuracy": 0.825,        // 0..1, không làm tròn
  "checkerPassRate": 0.775,
  "outOfScopeCorrect": 0.9,
  // --- từ đây là khoá phụ ---
  "status": "final",
  "dirty": false,                   // working tree có thay đổi ngoài eval/results/ khi chạy
  "provider": "groq", "model": "qwen/qwen3.8-27b",
  "corpusRoot": "0xda14…17a5", "questionsHash": "0x…", "promptsHash": "0x…",
  "counts": { "inScope": 40, "outOfScope": 10, "infra": 0, "byOutcome": { "passed": 31, "rejected": { "C2": 1, "C3": 0, "C4": 3 }, "…": 0 } },
  "retrievalRecall": 0.9, "citationPrecision": 0.8,
  "byGroup": { "thu-viec": { "n": 10, "citationAccuracy": 0.9 } },
  "questions": [ { "id": "tv-01", "group": "thu-viec", "outcome": "passed", "cited": ["25.1"], "hit": true } ]
}
```

- **`commit` + `dirty`.** Commit một mình sẽ gán sai số cho code đã đổi. Runner ghi `dirty = true` nếu có thay đổi chưa commit ngoài `eval/results/`. Số trên README/slide nên lấy từ lần chạy **`dirty: false`**; nếu `dirty: true`, runner in cảnh báo rõ. Link commit trên dashboard W4 vẫn trỏ commit sạch (không chèn hậu tố vào `commit`).
- **API đọc file từ đường dẫn trong repo** (`history.service` `DEFAULT_EVAL_PATH`), nên bản triển khai chỉ thấy số liệu khi `latest.json` **được commit**. Commit là quyết định của owner (AGENTS.md); runner không commit.
- **README (AP-09-AC03):** runner **không sửa README**. Cuối lần chạy nó in một dòng sẵn để chép, kèm ngày và commit, ví dụ: `Trích đúng Khoản 82,5% (33/40) · Đạt checker 77,5% (31/40) · Ngoài phạm vi 90% (9/10) · chạy 20/11/2026 · commit 345f9e7 · groq qwen/qwen3.8-27b`. Owner chép cùng dòng này sang README và slide để ba nơi khớp nhau.

## 7. Cây file và lệnh

| Đường dẫn | Nội dung |
|---|---|
| `eval/questions.json` | Bộ câu hỏi (dữ liệu, owner xác nhận) |
| `eval/results/latest.json` | Kết quả chốt, **commit** |
| `eval/results/draft.json`, `.checkpoint.json` | Gitignore |
| `apps/api/src/eval/dataset.ts` | Schema zod + validator (thuần) |
| `apps/api/src/eval/score.ts` | Phân loại outcome và tính các số (thuần) |
| `apps/api/src/eval/report.ts` | Quyết định trạng thái/exit code, dựng `latest.json`, dòng README, phát hiện `dirty` (thuần) |
| `apps/api/src/eval/checkpoint.ts` | Đọc/ghi checkpoint (ghi nguyên tử: file tạm rồi đổi tên) |
| `apps/api/src/eval/runner.ts` | Chạy từng câu: bọc LLM (nhịp, 429), checkpoint |
| `apps/api/src/eval/cli.ts` | Đọc env, git, gọi runner, ghi file, exit code |
| `apps/api/test/eval/*.test.ts` | Test theo AP-09-ACnn (§8) |

**Vì sao đặt trong `apps/api/src/eval/` mà không phải `eval/run.ts` hay `scripts/*.mjs`:**
- Vitest chỉ nhặt `{apps/api,packages/*}/test`; `eval/` không phải workspace. Để hàm tính điểm và validator nằm trong `npm run verify`, chúng phải ở một nơi có sẵn test runner.
- `packages/` không được import `apps/` (codebase.md §3), nên không đặt ở `packages/`.
- Nó nằm ngoài `modules/` và **không** được import từ `app.ts`/`compose.ts`, nên không vào luồng chạy của server. Chỉ `dataset.ts`/`score.ts`/`runner.ts` dùng service hiện có qua hàm tạo công khai.
- Dữ liệu và kết quả vẫn ở `eval/` gốc, đúng đường `history.service` đã đọc.

**Lệnh:** `"eval": "tsc --build && node --env-file=.env.poc apps/api/dist/eval/cli.js"`, cùng kiểu với `check:live`.

**Cập nhật tài liệu khi làm** (đây là lệch có chủ ý so với bản cũ, không phải lệch ngầm): [codebase.md](../architecture/codebase.md) dòng `eval/ questions.json · run.ts · results/` đổi thành đường ở bảng trên; thêm `eval/results/draft.json` và `.checkpoint.json` vào `.gitignore`; tasks.csv ghi E1.

## 8. Kiểm chứng

Test chạy trong `npm run verify`, **không cần mạng**: LLM giả.

| Tiêu chí | Test |
|---|---|
| **AP-09-AC01** | Validator trên `eval/questions.json` thật: số câu, 5 nhóm, mỗi `gold` có trong corpus, `gold` rỗng đúng ở ngoài phạm vi, không `#demo-`, không trùng. Từng luật của §3.2 có một ca thất bại riêng trên dữ liệu bịa. |
| **AP-09-AC02** | Bảng ca cho `score.ts`: mỗi outcome vào/ra mẫu số đúng như §4 (đặc biệt: `no-citation` ngoài phạm vi là sai; `infra` bị loại; câu ngoài phạm vi không vào `checkerPassRate`). Runner với LLM giả: bộ 6–8 câu cho ra ba số định trước; 429 hai lần rồi thành công thì không phải `infra`; 429 quá 3 lần thì là `infra`; checkpoint dùng lại câu cũ và bỏ khi khoá lệch. |
| **AP-09-AC02** (không trả tiền) | Test khẳng định runner không import `payment`/chain và không đọc `CHECKER_PRIVATE_KEY`. |
| **AP-09-AC03** | `latest.json` do runner sinh qua `evalSummarySchema.safeParse`; có `runAt`, `commit`, `dirty`. Trạng thái không-final không ghi `latest.json`. |

**Chưa kiểm bằng test, chỉ bằng chạy thật:** chất lượng thật của Groq trên bộ này, nhịp 20 giây có đủ tránh 429 hay không. Báo cáo verify phải nói rõ phần "đã chạy live" và "chưa".

## 9. Trạng thái và lỗi

| Tình huống | Điều người dùng lệnh thấy |
|---|---|
| Thiếu khoá, validator hỏng | Một dòng lỗi, không gửi gì tới LLM |
| Đang chạy | Mỗi câu một dòng: `[12/50] tv-03 passed (Đ25.1) 18s`; ước lượng thời gian còn lại |
| Hết quota giữa chừng | Các câu còn lại `infra`; kết thúc exit 2; chạy lại thì tiếp từ checkpoint |
| Ctrl+C | Checkpoint đã ghi tới câu cuối hoàn tất |
| Xong | Bảng ba số kèm mẫu số, số đếm outcome, dòng để chép README (§6) |

## 10. Câu hỏi mở (owner chốt)

| Mã | Câu hỏi | Đề xuất | Chốt |
|---|---|---|---|
| **U-27** | Owner xác nhận từng nhãn `gold` và điền `reviewed`; chưa xác nhận thì không có `latest.json`. Agent soạn nháp theo §3.3. | Có. Đây là đường găng của E1: dành thời gian xem ~40 nhãn trong phạm vi. | ✅ Owner duyệt 20/11/2026 theo đề xuất, **chỉ phần quy trình**. Từng nhãn `gold` vẫn do owner xem và điền `reviewed`; chưa làm. |
| **U-28** | "Trích đúng Khoản": mẫu số là câu trong phạm vi, **đúng khi ≥ 1 trích dẫn thuộc `gold`**; `citationPrecision` chỉ là số phụ. | Như trên. Phương án khác: lấy precision làm số chính (khắt khe hơn, số thấp hơn). | ✅ Owner duyệt 20/11/2026 theo đề xuất. |
| **U-29** | Model: mặc định Q-01 (Groq `qwen/qwen3.8-27b`); khác thì chỉ ra `draft.json`. | Như trên. | ✅ Owner duyệt 20/11/2026 theo đề xuất. |
| **U-30** | "Ngoài phạm vi": đúng khi `noBasis === true` (chặt); `no-citation` tính sai. | Chặt. Phương án lỏng (`noBasis` hoặc 0 trích dẫn) cho số cao hơn nhưng mô tả sai điều người dùng thấy. | ✅ Owner duyệt 20/11/2026 theo đề xuất. |
| **U-31** | Ngưỡng 70% của T-05 áp cho `citationAccuracy`. | Như trên. | ✅ Owner duyệt 20/11/2026 theo đề xuất. |
| **U-32** | Bộ 50 = 10 mỗi nhóm; `ngoai-pham-vi` 10 câu. | Như trên, hoặc 8/8/8/8 + 18 ngoài phạm vi nếu muốn số thứ ba bớt nhảy. | ✅ Owner duyệt 20/11/2026 theo đề xuất. |
| **U-33** | Lần chạy dùng quota Groq **dùng chung với API chạy thật** và gửi bộ câu hỏi (do owner xác nhận, không có dữ liệu cá nhân) tới Groq. Lần chạy live đầu tiên cần owner đồng ý và nên tránh giờ quay video/Demo Day. | Cho phép chạy ngoài giờ demo. | ✅ Owner duyệt 20/11/2026 theo đề xuất: được chạy live ngoài giờ quay video/Demo Day. |
| **U-34** | `latest.json` được commit (cần để bản deploy thấy số), và README/slide dùng số của lần chạy `--fresh`, `dirty: false`. Thứ tự đề xuất: commit code → chạy `--fresh` → commit `latest.json`. | Như trên; owner là người commit. | ✅ Owner duyệt 20/11/2026 theo đề xuất. |

## 11. Rủi ro và lịch

- **Trễ lịch:** hạn gốc 18/11, hôm nay 20/11, hạn nộp 21/11 (nên nộp trước 20:00, [plan §6](../runbook/plan.md)). E1 chặn O1 (README). Owner đã nói chưa cắt việc; không đề xuất cắt ở đây. Thứ tự giảm rủi ro: **soạn nháp bộ câu hỏi song song với viết code** để owner xem nhãn sớm; code runner chỉ vài trăm dòng và test chạy không cần mạng; chừa chỗ cho ít nhất hai lần chạy live (một để dò nhịp, một lần `--fresh` để chốt).
- **Số thấp.** Nếu `citationAccuracy` < 70%: báo owner, kèm `retrievalRecall`. Hiển thị thật thay vì giấu (plan §8: "hiển thị thay vì giấu"). Sửa prompt là việc khác và sẽ làm lệch các câu đã dùng để chỉnh.
- **Trôi so với pipeline** (§2): ghi nhận, tách `answerAndCheck()` sau khi W5 xong.
- **Quota Groq dùng chung** (§5) và **một câu = 2,5–10%** (§3.1): nói rõ khi trình bày số.
- **Kết quả biến thiên giữa các lần chạy** vì LLM: README ghi số của đúng một lần chạy, kèm ngày và commit.

## 12. Ngoài phạm vi E1

Chạy lặp, kiểm khoảng tin cậy; embedding; so sánh nhiều model; tách `answerAndCheck()`; tự sửa README hay slide; chạy trong CI; chạy qua `POST /ask` thật (cần chain).
