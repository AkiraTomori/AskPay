// Every user-facing string of the dashboard (design W4 §9). Vietnamese only in the MVP.
// Badge labels come from components/question; refund sentences from REFUND_REASONS and error
// sentences from ERROR_CODES in @askpay/shared. No string here says "Đã xác minh" (W3-E18).
import type { RefundReasonCode } from '@askpay/shared/errors';

export const dashboardMessages = {
  title: 'Dashboard',
  pageTitle: 'Dashboard · AskPay',
  intro: 'Số liệu công khai, tính từ event on-chain.',
  tiles: {
    questions: 'Câu hỏi',
    paid: 'Đã thanh toán',
    refunded: 'Đã hoàn tiền',
    revenue: 'Provider đã nhận',
  },
  statsLabel: 'Số liệu tổng hợp',
  questionsSub: 'đã giữ tiền',
  refundRateSub: (pct: string) => `${pct} tỉ lệ hoàn tiền`,
  noSettledYet: 'chưa có câu đã chốt',
  vndEstimate: (vnd: string) => `≈ ${vnd}đ (ước tính)`,
  provenance: (block: string) => `Tính từ event on-chain, khối #${block}`,
  contract: 'Contract',
  noEventsYet: 'Chưa đọc được event nào từ blockchain.',
  reconnecting: 'đang thử kết nối lại',
  reasonsTitle: 'Lý do hoàn tiền',
  noRefunds: 'Chưa có câu nào bị hoàn tiền.',
  reasonLabel: {
    NO_CITATION: 'Không có trích dẫn',
    INVALID_CITATION: 'Trích dẫn sai luật đã đăng ký',
    CHECKER_REJECTED: 'Checker từ chối',
    ANSWER_FAILED: 'Lỗi khi trả lời',
    TIMEOUT: 'Quá hạn',
  } satisfies Record<RefundReasonCode, string>,
  // Read after the number by screen readers: "Không có trích dẫn: 6 câu".
  reasonUnit: ' câu',
  evalTitle: 'Chất lượng (eval)',
  evalMetrics: {
    citationAccuracy: 'Trích đúng Khoản',
    checkerPassRate: 'Đạt checker',
    outOfScopeCorrect: 'Ngoài phạm vi đúng là không có căn cứ',
  },
  evalRun: (date: string) => `Chạy ngày ${date}`,
  evalCommit: 'commit',
  evalNote: 'Đo trên bộ khoảng 50 câu hỏi mẫu, không trả tiền thật.',
  recentTitle: 'Câu hỏi gần nhất',
  columns: { time: 'Thời gian', question: 'Câu hỏi', status: 'Trạng thái', tx: 'Tx' },
  noTx: 'chưa có tx',
  loadMore: 'Xem thêm',
  loadingMore: 'Đang tải…',
  loadedMore: (n: number) => `Đã tải thêm ${n} câu hỏi.`,
  loadMoreFailed: 'Không tải thêm được. Thử lại.',
  empty: 'Chưa có câu hỏi nào.',
  askFirst: 'Hỏi câu đầu tiên',
  emptyButCounted: 'Chưa có câu hỏi nào để hiển thị. Số liệu phía trên vẫn tính từ blockchain.',
  statsFailed: 'Không tải được số liệu.',
  listFailed: 'Không tải được danh sách câu hỏi.',
  retry: 'Thử lại',
  loading: 'Đang tải…',
};
