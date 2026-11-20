// Every user-facing string of /verify (design W5 §8). Vietnamese only in the MVP.
// Forbidden here (spec §8): "Đã xác minh trích dẫn", "kiểm đúng nguyên văn", "checker độc lập".
export const verifyMessages = {
  pageTitle: 'Tự xác minh · AskPay',
  title: 'Tự xác minh',
  intro: 'So bản luật trong repo với bản đã đăng ký trên blockchain.',
  lawTitle: 'Bộ luật',
  repoRoot: 'Root trong repo',
  chainRoot: 'Root trên contract',
  lawId: 'lawId',
  match: 'KHỚP',
  mismatch: 'LỆCH',
  unregistered: 'CHƯA ĐĂNG KÝ',
  matchText: 'Root trong repo khớp root đã đăng ký trên contract.',
  mismatchText:
    'Root trong repo khác root trên contract. Bản luật trong repo không phải bản đã đăng ký.',
  unregisteredText: 'Contract chưa có root cho bộ luật này.',
  readFailed: 'Không đọc được contract.',
  retry: 'Thử lại',
  lawCounts: (dieu: number, khoan: number) => `${dieu} Điều · ${khoan} Khoản`,
  contractTitle: 'Contract',
  escrow: 'Escrow',
  sourceOnSnowtrace: 'mã nguồn trên Snowtrace',
  provider: 'Provider',
  checker: 'Checker',
  answerWindow: 'Thời hạn trả lời',
  token: 'Token',
  minutes: (n: number) => `${n} phút`,
  seconds: (n: number) => `${n} giây`,
  rolesNote:
    'Provider gửi tiền vào và chốt. Checker ký kết luận kiểm tra bằng khoá riêng. Ở v1 cả hai do AskPay vận hành.',
  deploymentsFallback: '(theo file deployments, chưa đọc được từ contract)',
  roleDiffers: 'Khác với contracts/deployments/fuji.json trong repo.',
  stepsTitle: 'Tự kiểm trong 3 bước',
  steps: ['Tải repo', 'Dựng lại corpus', 'Đọc root on-chain'],
  step2Note:
    'Lệnh này dựng lại corpus và Merkle root từ văn bản gốc trong repo. Không có thay đổi nào (git diff không in gì) nghĩa là root dựng lại đúng bằng root đã commit. Root cũng được in ra ở dòng root: 0x….',
  step3Note: 'Cần Foundry (cast). Kết quả phải bằng root ở bước 2.',
  scopeNote:
    'Trang này chỉ so Merkle root của bộ luật. Để kiểm đoạn trích của một câu trả lời, dùng hàm citationsHash() trong packages/shared và so với citationsHash trong event Paid của tx chốt trên Snowtrace.',
  unknownCount: '—',
} as const;
