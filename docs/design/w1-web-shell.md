# W1 — Web shell, kết nối ví, NetworkGuard, DisclaimerBanner

> **Trạng thái:** đã duyệt (15/11/2026), gồm U-01..U-04 như đề xuất; đã cài đặt trên nhánh `feat/w1-web-shell`. Ticket W1 ([tasks.csv](../runbook/tasks.csv)), hạn 16/11.
> Nguồn: [ui-pages §2](../product/ui-pages.md#2-app-shell-mọi-trang), [design-system](../product/design-system.md), [frontend convention](../conventions/frontend.md), spec [AP-07-AC04](../spec/askpay-v1.md).
> Tài liệu này chỉ chốt **giao diện và tương tác** của shell. Không đổi hành vi trong spec, không đổi API.

## 1. Người dùng và việc cần làm

- **Ai:** người hỏi có ví trình duyệt (Core hoặc MetaMask), thường lần đầu dùng Fuji. Ban giám khảo xem demo trên laptop; một số mở link trên điện thoại.
- **Việc ở W1:** mở trang → thấy ngay đây là dịch vụ tham khảo pháp lý (disclaimer) → kết nối ví → nếu ví ở sai mạng thì chuyển sang Fuji bằng một nút → thấy địa chỉ và số dư USDC testnet.
- **Không thuộc W1:** form hỏi, báo giá, ký (W2); trang kết quả (W3); dashboard (W4); `/verify` (W5).
- **Từ ngữ cố định:** "Kết nối ví", "Ngắt kết nối", "Đang ở sai mạng", "Chuyển sang Avalanche Fuji", "Thông tin tham khảo, không thay thế tư vấn pháp lý."

## 2. Bố cục shell

```
┌──────────────────────────────────────────────────────────────────┐
│ ⚠ Ví đang ở sai mạng. AskPay chỉ chạy trên Avalanche Fuji.        │ NetworkGuard (chỉ khi sai mạng)
│                                   [Chuyển sang Avalanche Fuji]    │
├──────────────────────────────────────────────────────────────────┤
│ ⚖ AskPay   Hỏi                              [● Fuji] [0xab…cd ▾] │ SiteHeader
├──────────────────────────────────────────────────────────────────┤
│                    <main id="main"> (nội dung trang)              │
├──────────────────────────────────────────────────────────────────┤
│ ⓘ Thông tin tham khảo, không thay thế tư vấn pháp lý.             │ DisclaimerBanner
│ Contract 0x869e…dce0 ↗ · Bộ luật Lao động 2019 (45/2019/QH14)      │ SiteFooter
└──────────────────────────────────────────────────────────────────┘
```

Thứ tự DOM (cũng là thứ tự Tab): link "Bỏ qua tới nội dung" → NetworkGuard → header (logo, nav, chip mạng, ConnectButton) → `main` → disclaimer → footer.

### 2.1 Cây component (theo frontend convention §1)

| File | Vai trò |
|---|---|
| `app/layout.tsx` | Font (`next/font`, subset `vietnamese`), `<html lang="vi">`, `Providers`, `AppShell` |
| `app/providers.tsx` (`'use client'`) | `WagmiProvider` + `QueryClientProvider` |
| `app/global-error.tsx` | Thay cả root layout khi lỗi, nên **tự render `DisclaimerBanner`** |
| `components/layout/AppShell.tsx` | Ghép NetworkGuard, SiteHeader, main, DisclaimerBanner, SiteFooter |
| `components/layout/SiteHeader.tsx`, `SiteFooter.tsx`, `DisclaimerBanner.tsx`, `MobileNav.tsx` | |
| `components/wallet/ConnectButton.tsx`, `ConnectDialog.tsx`, `AccountMenu.tsx`, `NetworkGuard.tsx`, `NetworkChip.tsx` | |
| `components/wallet/use-wallet-status.ts` | Hook trạng thái ví dùng chung (§5), W2 dùng lại |
| `components/ui/Button.tsx`, `Address.tsx`, `Dialog.tsx` | Chỉ những component W1 cần |
| `lib/wagmi.ts` | Config: **chỉ** `avalancheFuji`, connector `injected` |
| `lib/format.ts` | `formatUsdcVi(bigint)` (bọc `formatUsdc` của shared, đổi `.` → `,`), `shortAddress`, `snowtraceAddressUrl` |
| `lib/messages.ts` | Mọi chuỗi ở §7 |

Địa chỉ escrow và token lấy từ `fujiDeployment` của `@askpay/shared/abi`. Không chép địa chỉ vào `apps/web`.

## 3. Kết nối ví

### 3.1 Cấu hình

- `createConfig({ chains: [avalancheFuji], connectors: [injected()], transports: { [43113]: http(RPC_URL) }, ssr: true })`.
- Giữ `multiInjectedProviderDiscovery` mặc định (bật), để ví báo mình qua **EIP-6963**. Core và MetaMask hiện thành hai mục riêng, kèm tên và icon do chính ví cung cấp, kể cả khi cả hai cùng cài và tranh `window.ethereum`.
- Không thêm WalletConnect hay bộ UI ví (libraries.md).
- Chỉ có một chain trong config, nên **phát hiện sai mạng bằng `useConnection().chainId`** (wagmi 3; `useAccount` là bí danh đã deprecated), không dùng `useChainId()` (hook này luôn trả chain của config).

### 3.2 `ConnectButton`: các trạng thái

| Trạng thái (wagmi) | Hiển thị | Thao tác |
|---|---|---|
| `reconnecting` lúc tải trang | Skeleton cùng kích thước nút (không nháy "Kết nối ví" rồi đổi). Giữ skeleton tới khi lần nối lại của wagmi kết thúc (`ReconnectGate`), vì sau hydrate wagmi báo `disconnected` một nhịp | — |
| `disconnected` | Nút `primary` "Kết nối ví" | Mở `ConnectDialog` |
| `connecting` | Nút loading "Đang kết nối…", vô hiệu | — |
| `connected` + Fuji | `0xab…cd` (mono) · `12,5 USDC` | Mở `AccountMenu` |
| `connected` + đang tải số dư | `0xab…cd` · skeleton nhỏ | |
| `connected` + lỗi đọc số dư | `0xab…cd` · `— USDC` (có `title` "Không đọc được số dư") | Đọc lại khi focus cửa sổ |
| `connected` + sai mạng | `0xab…cd` · **ẩn số dư** (số dư ở chain khác là sai nghĩa) | Mở `AccountMenu`; NetworkGuard hiện ở trên |

Số dư: `useReadContract(balanceOf)` trên `fujiDeployment.token`, `chainId: 43113` cố định, refetch khi focus cửa sổ. Giữ `bigint` tới lúc định dạng. Không làm tròn: `formatUsdcVi(12_500000n)` cho `12,5`. W2 gọi lại cùng query sau khi trả tiền.

### 3.3 `ConnectDialog`

Hộp thoại modal, tiêu đề "Kết nối ví".

| Trạng thái | Nội dung |
|---|---|
| Có ví (EIP-6963) | Danh sách nút: icon + tên ví (ví dụ "Core", "MetaMask"). Dưới cùng: "AskPay chỉ dùng mạng thử nghiệm Avalanche Fuji. Không có tiền thật." |
| Không thấy ví nào | "Chưa thấy ví nào trong trình duyệt." + hai link ↗ "Cài Core" và "Cài MetaMask" (trang chính thức, tab mới) |
| Đang chờ ví | Mục đã chọn hiện spinner + "Mở ví để xác nhận…"; các mục khác vô hiệu; nút "Huỷ" đóng hộp thoại |
| Người dùng từ chối (`UserRejectedRequestError`, 4001) | Về danh sách, dòng thông báo trung tính "Bạn đã huỷ kết nối." (màu `ink-muted`, không đỏ) |
| Ví đã có yêu cầu đang chờ (-32002) | "Ví đang có một yêu cầu chờ. Mở tiện ích ví để xử lý." |
| Lỗi khác | "Không kết nối được ví. Thử lại." (màu `error`), giữ danh sách để thử lại |
| Kết nối thành công | Tự đóng, focus về `ConnectButton` (giờ là nút tài khoản) |

Kết nối xong mà ví ở sai mạng: **không** tự gọi chuyển mạng. Đóng hộp thoại và để NetworkGuard hiện. Lý do: hai popup ví liên tiếp dễ làm người dùng bấm từ chối.

### 3.4 `AccountMenu`

Menu thả từ nút tài khoản (`aria-haspopup="menu"`, `aria-expanded`):

1. Địa chỉ đầy đủ (mono, xuống dòng được) + "Sao chép địa chỉ". Sao chép xong thì đổi nhãn thành "Đã sao chép" trong 2 giây, kèm `aria-live="polite"`.
2. "Xem trên Snowtrace ↗" (`testnet.snowtrace.io/address/<addr>`, tab mới).
3. "Lấy USDC testnet ↗" (faucet; W2 dùng lại cùng link cho AP-03-AC05).
4. "Ngắt kết nối".

Phím: mũi tên lên/xuống di chuyển, Esc đóng và trả focus về nút, Tab rời menu thì đóng.

### 3.5 Thay đổi phía ví

- Đổi tài khoản trong ví: địa chỉ và số dư cập nhật ngay, không cần tải lại.
- Khoá ví hoặc ngắt kết nối từ ví: về `disconnected`.
- Đổi mạng trong ví: NetworkGuard hiện hoặc ẩn ngay theo `chainId`.
- **Giao ước cho W2:** `useAsk` phải huỷ báo giá đang giữ khi `address` hoặc `chainId` đổi. W1 chỉ cung cấp tín hiệu (§5).

## 4. `NetworkGuard`

Chỉ render khi `status = connected` **và** `chainId ≠ 43113`. Chưa kết nối thì không hiện (chưa có mạng nào để sai).

| Trạng thái | Hiển thị |
|---|---|
| Sai mạng | Icon `triangle-alert` + "Ví đang ở sai mạng. AskPay chỉ chạy trên Avalanche Fuji." + nút `primary` "Chuyển sang Avalanche Fuji" |
| Đang chuyển | Nút loading "Xác nhận trong ví…", vô hiệu |
| Fuji chưa có trong ví (4902) | wagmi tự gọi `wallet_addEthereumChain` với thông số `avalancheFuji`; người dùng thấy popup "Thêm mạng" của ví. Không cần UI riêng |
| Từ chối chuyển (4001) | Thanh vẫn hiện, thêm dòng "Bạn đã huỷ chuyển mạng." Nút bấm lại được |
| Ví không cho chuyển bằng lệnh | "Không chuyển tự động được. Mở ví và chọn mạng Avalanche Fuji (chain ID 43113)." |
| Chuyển xong | Thanh biến mất; focus chuyển về nút tài khoản (thanh đã mất thì focus không được rơi vào `body`) |

- Vị trí: trên cùng, **trong luồng trang** (không `position: fixed`), để không che header trên mobile.
- `role="status"` (đọc một lần khi hiện, không ngắt lời như `alert`).
- Màu (xem §6.2): nền hổ phách nhạt, viền trái 3px `refund`, **chữ `ink`**.
- Thanh không đóng được: sai mạng thì mọi thao tác trả tiền đều hỏng.
- `NetworkChip` trong header: trên Fuji là "● Fuji" (chấm `paid` + chữ). Sai mạng là "Sai mạng" (icon + chữ). Màu không bao giờ là tín hiệu duy nhất.

## 5. Hook `useWalletStatus` (giao ước cho W2–W5)

```ts
type WalletStatus =
  | { kind: 'loading' }                              // reconnecting lúc tải trang
  | { kind: 'disconnected' }
  | { kind: 'connecting' }
  | { kind: 'wrongNetwork'; address: Address; chainId: number }
  | { kind: 'ready'; address: Address; usdc: bigint | undefined }; // undefined: đang tải hoặc lỗi
```

W2 dựa vào đây để chọn nhãn nút Hỏi ("Kết nối ví để hỏi", "Chuyển sang Fuji", …) theo ui-pages §3.1. W1 export thêm `openConnectDialog()` (qua context nhỏ trong `components/wallet`) để nút Hỏi mở cùng hộp thoại.

## 6. Disclaimer, header, footer

### 6.1 `DisclaimerBanner` (AP-07-AC04)

- Chữ đúng: "Thông tin tham khảo, không thay thế tư vấn pháp lý." Icon `info` + chữ `ink-muted` 14px trên nền `paper`, viền trên `rule`.
- Render trong **root layout**, nên có ở mọi route, kể cả `not-found` và `error.tsx`. `global-error.tsx` thay cả root layout nên tự render banner (test riêng).
- Là landmark `<aside aria-label="Lưu ý pháp lý">` (complementary), để người dùng đọc màn hình nhảy tới được; câu chữ không đổi.
- Không có nút đóng, không phụ thuộc trạng thái ví hay API, không có `aria-hidden`, không bị ẩn ở breakpoint nào.
- Vị trí: chân trang theo ui-pages §2. **Câu hỏi mở U-01** bàn chuyện có lặp lại câu này cạnh câu trả lời không.

### 6.2 Header

- Logo "AskPay" (icon `scale` màu `seal`) → `/`.
- Nav lấy từ một mảng cấu hình. **W1 chỉ có "Hỏi".** W4 thêm "Dashboard", W5 thêm "Xác minh". Không làm trang trống (U-02). Mục đang mở có `aria-current="page"`.
- **< 640px:** nav gập vào nút `menu` (`aria-expanded`, `aria-controls`). Chip mạng và nút ví **vẫn nằm ngoài menu**, vì đó là trạng thái người dùng cần thấy. Esc đóng menu, focus về nút. Địa chỉ rút gọn còn `0xab…cd`, ẩn số dư nếu không đủ chỗ (số dư vẫn có trong `AccountMenu`). Dưới 400px chữ "AskPay" cạnh logo chỉ còn cho trình đọc màn hình (vẫn có icon `scale`) để chip "Sai mạng" và nút ví vừa 360px trên một dòng.
- **≥ 1024px:** nội dung rộng tối đa 768px, căn giữa. Header và footer dùng cùng chiều rộng đó.

### 6.3 Footer

`Contract 0x869e…dce0 ↗` (TxLink/Address style, link Snowtrace address, `title` đầy đủ) · "Bộ luật Lao động 2019 (45/2019/QH14)". Footer hiện được kể cả khi API sập (dữ liệu tĩnh từ shared).

### 6.4 Tương phản (đã tính theo công thức WCAG, 15/11/2026)

| Cặp | Tỉ lệ | Kết luận |
|---|---|---|
| `ink` / `paper` | 16,09 | Đạt |
| `ink-muted` / `paper` (disclaimer) | 6,44 | Đạt |
| `seal-ink` / `seal` (nút primary) | 10,28 | Đạt |
| `focus` / `paper` (viền focus) | 7,77 | Đạt (≥ 3:1) |
| `refund` / `paper` | 4,76 | Đạt sát ngưỡng |
| **`refund` / hổ phách nhạt 12% (`#EEE5D3`)** | **4,07** | **Không đạt**: chữ NetworkGuard phải dùng `ink` (13,76) |
| **`rule` / `paper`** | **1,24** | Chỉ dùng cho đường kẻ trang trí. Viền nút `secondary` và viền ô nhập cần ≥ 3:1 (WCAG 1.4.11): dùng `ink-muted` |

Hai dòng in đậm là sửa nhỏ so với design-system §3 (`secondary` = "viền"). Đề xuất ghi vào design-system khi duyệt (U-03).

## 7. Chuỗi giao diện (`lib/messages.ts`)

```
connect: 'Kết nối ví'              connecting: 'Đang kết nối…'
dialogTitle: 'Kết nối ví'          openWallet: 'Mở ví để xác nhận…'
testnetNote: 'AskPay chỉ dùng mạng thử nghiệm Avalanche Fuji. Không có tiền thật.'
noWallet: 'Chưa thấy ví nào trong trình duyệt.'   installCore: 'Cài Core'   installMetaMask: 'Cài MetaMask'
connectRejected: 'Bạn đã huỷ kết nối.'
requestPending: 'Ví đang có một yêu cầu chờ. Mở tiện ích ví để xử lý.'
connectFailed: 'Không kết nối được ví. Thử lại.'
wrongNetwork: 'Ví đang ở sai mạng. AskPay chỉ chạy trên Avalanche Fuji.'
switchToFuji: 'Chuyển sang Avalanche Fuji'   switching: 'Xác nhận trong ví…'
switchRejected: 'Bạn đã huỷ chuyển mạng.'
switchUnsupported: 'Không chuyển tự động được. Mở ví và chọn mạng Avalanche Fuji (chain ID 43113).'
balanceUnavailable: 'Không đọc được số dư'
copyAddress: 'Sao chép địa chỉ'  copied: 'Đã sao chép'  viewOnSnowtrace: 'Xem trên Snowtrace'
getTestUsdc: 'Lấy USDC testnet'  disconnect: 'Ngắt kết nối'
skipToContent: 'Bỏ qua tới nội dung'  menu: 'Mở menu'
disclaimer: 'Thông tin tham khảo, không thay thế tư vấn pháp lý.'
```

## 8. Ví dụ chấp nhận (để viết test và demo thủ công)

| Mã | Cho / Khi / Thì | Kiểm bằng |
|---|---|---|
| W1-E01 (AP-07-AC04) | Mọi route (`/`, route không tồn tại, trang lỗi, `global-error`), mọi trạng thái ví, rộng 360px và 1280px → thấy đúng câu disclaimer, không có nút đóng | Vitest + Testing Library |
| W1-E02 | Chưa kết nối, có ví mock → bấm "Kết nối ví" → chọn ví → nút đổi thành địa chỉ rút gọn + số dư `0,05 USDC` (mock 50000n) | Vitest, connector `mock` của wagmi |
| W1-E03 | Từ chối kết nối → hộp thoại vẫn mở, hiện "Bạn đã huỷ kết nối.", không có chữ đỏ | Vitest (`mock` với `connectError`) |
| W1-E04 | Không có ví EIP-6963 nào → hiện link cài Core và MetaMask | Vitest |
| W1-E05 | Kết nối ở chain 1 → NetworkGuard hiện, số dư ẩn → bấm chuyển → chain 43113 → thanh biến mất, focus ở nút tài khoản | Vitest |
| W1-E06 | Từ chối chuyển mạng → thanh vẫn hiện + "Bạn đã huỷ chuyển mạng." | Vitest (`switchChainError`) |
| W1-E07 | Đổi tài khoản trong ví → địa chỉ và số dư cập nhật không cần tải lại | Vitest |
| W1-E08 | Toàn bộ shell dùng được chỉ bằng bàn phím: Tab tới link bỏ qua, mở/đóng hộp thoại và menu bằng Enter/Esc, focus luôn thấy | Thủ công + Testing Library |
| W1-E09 | Thật trên Fuji bằng **Core** (owner chốt 15/11/2026: một ví là đủ; **MetaMask chưa kiểm**): kết nối được; từ C-Chain mainnet bấm "Chuyển sang Avalanche Fuji" thì chuyển được; ví chưa có Fuji thì được hỏi thêm mạng | Thủ công, ghi lại ví + phiên bản (không có tx, không cần duyệt broadcast) |
| W1-E10 | Lighthouse a11y ≥ 90 trên `/` | Thủ công |

W1-E09 là "Xong khi" của ticket W1, chỉ với Core; MetaMask ghi là chưa kiểm. Đây là kiểm tra thủ công, không broadcast giao dịch nào.

## 9. Ngoài phạm vi W1

Chế độ tối, i18n, WalletConnect/điện thoại không có ví trình duyệt, hiển thị số dư AVAX, ENS, nhiều tài khoản cùng lúc.

## 10. Câu hỏi mở (owner chốt)

| Mã | Câu hỏi | Đề xuất |
|---|---|---|
| U-01 | "Luôn hiện" ở AP-07-AC04 nghĩa là có trên mọi trang (chân trang) hay luôn trong tầm nhìn (dính đáy màn hình)? | Chân trang ở W1. W3 lặp lại câu này ngay dưới câu trả lời, nơi người dùng đọc nội dung pháp lý. Không làm thanh dính đáy vì tốn chỗ trên mobile |
| U-02 | Nav có hiện "Dashboard", "Xác minh" trước khi W4/W5 xong không? | Không. Thêm mục khi trang có thật; `/verify` là P2 và có thể bị cắt |
| U-03 | Ghi vào design-system: chữ trên nền hổ phách nhạt dùng `ink`; viền nút `secondary`/ô nhập dùng `ink-muted` | Đồng ý (bắt buộc để đạt AA, xem §6.4) |
| U-04 | Màu thanh sai mạng: "vàng" ở ui-pages dùng chung tông `refund` (vốn mang nghĩa hoàn tiền) hay thêm token `--color-warn`? | Dùng chung tông `refund` cho v1, không thêm token. Khác biệt đã thể hiện bằng icon và chữ |
