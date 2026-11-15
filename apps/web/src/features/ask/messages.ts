import { BADGE_LABELS } from '@/components/question/status';

// Every user-facing string of the ask feature (design W2 §11). Vietnamese only in the MVP.
// Sentences for API error codes come from ERROR_CODES in @askpay/shared, not from here.
export const askMessages = {
  questionLabel: 'Câu hỏi của bạn',
  placeholder: 'Ví dụ: Thử việc tối đa bao lâu?',
  tooLong: 'Câu hỏi tối đa 500 ký tự',
  samplesLabel: 'Gợi ý:',
  samples: [
    {
      label: 'Thử việc',
      question: 'Thời gian thử việc tối đa với công việc cần bằng cao đẳng là bao lâu?',
    },
    { label: 'Làm thêm giờ', question: 'Mỗi tháng được làm thêm tối đa bao nhiêu giờ?' },
    { label: 'Nghỉ việc', question: 'Muốn nghỉ việc thì phải báo trước bao nhiêu ngày?' },
  ],
  ask: 'Hỏi',
  connectToAsk: 'Kết nối ví để hỏi',
  switchToFuji: 'Chuyển sang Fuji',
  connecting: 'Đang kết nối…',
  quoting: 'Đang lấy giá…',
  pay: (amount: string) => `Ký và trả ${amount} USDC`,
  newQuote: 'Lấy giá mới',
  confirmInWallet: 'Xác nhận trong ví…',
  sending: 'Đang gửi…',
  checking: 'Đang kiểm tra…',
  opening: 'Đang mở trang câu hỏi…',
  retry: 'Thử lại',
  resend: 'Gửi lại',
  vndEstimate: (vnd: string) => `≈ ${vnd}đ (ước tính)`,
  priceLabel: 'Giá câu hỏi',
  escrowNote: 'Tiền vào escrow, không vào ví của AskPay.',
  refundNote: 'Không qua kiểm tra thì contract hoàn tiền.',
  quoteCountdown: (mmss: string) => `Báo giá còn ${mmss}`,
  quoteExpiringSoon: 'Báo giá sắp hết hạn.',
  signHint: (amount: string) => `Ví sẽ hỏi bạn ký uỷ quyền chuyển ${amount} USDC vào escrow.`,
  signRejected: 'Bạn đã huỷ ký. Câu hỏi vẫn còn đây.',
  signFailed: 'Không ký được trong ví. Bạn chưa bị trừ tiền, hãy thử lại.',
  insufficient: (balance: string, price: string) => `Số dư ${balance} USDC, cần ${price} USDC.`,
  getTestUsdc: 'Lấy USDC testnet',
  quoteExpired: 'Báo giá đã hết hạn, bạn chưa bị trừ tiền.',
  expiredWhileSigning: 'Báo giá đã hết hạn trong lúc ký, bạn chưa bị trừ tiền.',
  quoteMismatch: 'Báo giá không khớp contract đã công bố. AskPay không mở ví.',
  // AP-03-AC07 wording, for the ask flow only: CHAIN_UNAVAILABLE is also thrown by read-only
  // endpoints (the dashboard), where "not accepting questions" would be wrong.
  chainBusy: 'Hệ thống tạm không nhận câu hỏi. Bạn chưa bị trừ tiền, hãy thử lại sau.',
  networkError: 'Không kết nối được máy chủ. Bạn chưa bị trừ tiền, hãy thử lại.',
  unsure: 'Đang kiểm tra thanh toán trên blockchain. Đừng ký lại.',
  openQuestion: 'Mở trang câu hỏi',
  signatureExpired: 'Chữ ký đã hết hạn và bạn chưa bị trừ tiền. Hãy lấy giá mới.',
  steps: ['Giữ tiền', 'Trả lời', 'Kiểm tra', 'Chốt'],
  stepsLabel: 'Tiến trình xử lý',
  stepState: { running: 'đang chạy', done: 'xong', skipped: 'bỏ qua', pending: 'chưa tới' },
  notHeld: 'Chưa giữ tiền',
  // /questions/[qid] (design W3 §10)
  yourQuestion: 'Câu hỏi',
  badge: BADGE_LABELS,
  // Read out by the one polite live region, only when the badge changes.
  badgeAnnounce: { paid: 'Đã thanh toán', refunded: 'Đã hoàn tiền', expired: 'Quá hạn' },
  answerHeading: 'Câu trả lời',
  citationsHeading: 'Căn cứ',
  txDeposit: 'Giữ tiền',
  txPaid: 'Thanh toán',
  txRefund: 'Hoàn tiền',
  khoanTitle: (dieu: number, khoan: number, title: string) =>
    khoan > 0 ? `Điều ${dieu} · Khoản ${khoan} — ${title}` : `Điều ${dieu} — ${title}`,
  // The two lines of the verification mark (Q-10). Always rendered together.
  verifiedMain: 'Khoản có trong luật đã đăng ký on-chain',
  verifiedSub: 'Đoạn trích và mức liên quan: checker đã ký',
  showFullText: 'Xem nguyên văn',
  quotedPart: 'đoạn được trích',
  fullTextMissing: 'Chưa tải được nguyên văn Khoản này.',
  notVerified: 'Chưa đối chiếu được trích dẫn với blockchain.',
  retrying: 'Đang thử lại…',
  noBasisTitle: 'Không tìm thấy căn cứ trong Bộ luật Lao động 2019',
  failedCheckWarning: 'Câu trả lời dưới đây không đạt kiểm tra, đừng dựa vào nó.',
  // TIMEOUT with an answer: the checker never ran, so "chưa qua kiểm tra", not "không đạt".
  uncheckedWarning: 'Câu trả lời dưới đây chưa qua kiểm tra, đừng dựa vào nó.',
  answerFailed: 'Hệ thống không trả lời được lúc này, bạn đã được hoàn tiền.',
  timeoutRefunded: 'Tiền đã được trả lại vào ví của bạn.',
  refundedGeneric: 'Đã hoàn tiền vào ví của bạn.',
  reconnecting: 'Mất kết nối, đang thử lại…',
  // The page stopped asking (no read is scheduled), so it must not say "retrying".
  connectionLost: 'Mất kết nối. Thông tin trên trang có thể đã cũ.',
  settleStalled: 'Chưa nhận được xác nhận chốt từ blockchain.',
  askAnother: 'Hỏi câu khác',
  askAgain: 'Hỏi lại',
  statusClaimable: 'Đã quá 10 phút mà chưa có kết quả.',
  notHeldPage: 'Chưa giữ tiền. Bạn chưa bị trừ tiền.',
  notFound: 'Không tìm thấy câu hỏi này.',
  loadFailed: 'Không tải được kết quả.',
  loading: 'Đang tải…',
  // The tab title: the question on one line, cut to 60 characters (not UTF-16 units).
  pageTitle: (question: string) => {
    const chars = Array.from(question.replace(/\s+/gu, ' ').trim());
    const short = chars.length > 60 ? `${chars.slice(0, 60).join('')}…` : chars.join('');
    return short === '' ? 'AskPay' : `${short} · AskPay`;
  },
} as const;
