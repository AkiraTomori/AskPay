# Smart contract convention (Solidity, Foundry)

Áp dụng cho `contracts/` và mọi thao tác on-chain. Phần này Fablewelf không có; viết mới cho AskPay.

## 1. Cấu trúc

```
contracts/
  foundry.toml
  src/AskPayEscrow.sol
  test/AskPayEscrow.t.sol       # unit + fuzz
  test/helpers/                 # token EIP-3009 giả, dựng Merkle tree mẫu
  script/Deploy.s.sol
  script/RegisterLawRoot.s.sol
  deployments/fuji.json         # địa chỉ đã deploy: nguồn sự thật duy nhất
  lib/                          # forge install (forge-std, openzeppelin-contracts)
```

- Một contract chính (`AskPayEscrow`). Chỉ tách thêm khi có lý do ghi trong PR.
- `contracts/` nằm ngoài npm workspaces. Script `npm run abi` sinh ABI và địa chỉ sang `packages/shared`.

## 2. Phong cách

- Ghim phiên bản `pragma solidity 0.8.x` chính xác, khớp `foundry.toml`.
- Dùng OpenZeppelin cho thứ đã có sẵn: `MerkleProof`, `ECDSA`, `EIP712`, `Ownable`, `ReentrancyGuard`. Không tự viết lại.
- Lỗi bằng custom error (`error QuestionNotOpen(bytes32 qid);`), không chuỗi `require`.
- Mỗi thay đổi trạng thái phát **event**. Dashboard và indexer đọc từ event.
- Thứ tự trong hàm: kiểm tra → cập nhật trạng thái → chuyển tiền (checks-effects-interactions). Hàm chuyển tiền có `nonReentrant`.
- Tên: contract `PascalCase`; hàm và biến `camelCase`; hằng `UPPER_SNAKE_CASE`; biến immutable/constant khai báo rõ.
- NatSpec (`@notice`, `@param`) cho mọi hàm `external`.
- `forge fmt` là chuẩn định dạng.

## 3. Bất biến phải giữ (và phải có test)

1. Mỗi `qid` chỉ deposit một lần và chỉ chốt (Paid hoặc Refunded) một lần.
2. Tổng USDC contract đang giữ = tổng `amount` của các câu hỏi đang `Open`.
3. Tiền chỉ đi tới **đúng người hỏi** (hoàn tiền) hoặc **đúng provider** (trả tiền); không địa chỉ thứ ba.
4. Nếu không ai chốt trước `deadline`, người hỏi luôn rút lại được.
5. Trích dẫn chỉ được coi là hợp lệ khi Merkle proof khớp `lawRoot` đã đăng ký **và** chữ ký checker hợp lệ.

## 4. Test

- `forge test` phải xanh. Mỗi hàm `external` có ca thành công và ca thất bại.
- Fuzz cho số tiền, thời gian (`vm.warp`) và proof sai.
- Dùng token EIP-3009 giả trong test, không phụ thuộc USDC thật trên Fuji.
- Tên test: `test_AP03_AC02_wrongCitationRefundsPayer`, `testFuzz_...`, `testRevert_...`.

## 5. Quy tắc on-chain (cho người và agent)

- **Mạng mặc định là Avalanche Fuji (chain id 43113).** Mainnet (43114) cấm trong MVP trừ khi owner yêu cầu rõ ràng.
- Mỗi lần **broadcast** (deploy, đăng ký root, gửi tx) cần owner đồng ý. Trước khi chạy, nêu rõ: mạng, ví ký, contract, hàm và tham số.
- Không bao giờ để private key hay seed phrase trong mã, commit, log, chat hoặc dòng lệnh. Dùng keystore của Foundry (`cast wallet import`, rồi `--account`) hoặc biến trong `.env`.
- Dùng **ví riêng cho hackathon**, không dùng ví chứa tài sản thật.
- Sau khi deploy, cập nhật `deployments/fuji.json` và verify contract trên Snowtrace trong cùng PR.
- Đổi corpus luật thì Merkle root đổi, nên phải đăng ký root mới (là một lần broadcast).
