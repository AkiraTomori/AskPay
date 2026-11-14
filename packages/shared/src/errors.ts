// Error codes and the Vietnamese sentences users see. Everything user-facing comes from here so
// the API and the web never disagree (contracts.md §6, api.md §1).

export const ERROR_CODES = {
  VALIDATION_FAILED: {
    httpStatus: 400,
    message: 'Câu hỏi không hợp lệ. Hãy nhập từ 1 đến 500 ký tự.',
  },
  PAYMENT_INVALID: {
    httpStatus: 402,
    message: 'Thanh toán không hợp lệ hoặc đã hết hạn. Hãy hỏi lại để nhận báo giá mới.',
  },
  QUESTION_NOT_FOUND: {
    httpStatus: 404,
    message: 'Không tìm thấy câu hỏi, hoặc báo giá đã hết hạn.',
  },
  QUESTION_ALREADY_SETTLED: {
    httpStatus: 409,
    message: 'Câu hỏi này đã được thanh toán hoặc đã được chốt trước đó.',
  },
  QUESTION_MISMATCH: { httpStatus: 409, message: 'Nội dung câu hỏi khác với câu đã báo giá.' },
  RATE_LIMITED: { httpStatus: 429, message: 'Bạn gửi quá nhiều yêu cầu. Hãy thử lại sau ít phút.' },
  LLM_UNAVAILABLE: { httpStatus: 502, message: 'Dịch vụ trả lời đang gián đoạn.' },
  CHAIN_UNAVAILABLE: {
    httpStatus: 503,
    message: 'Chưa kết nối được blockchain. Bạn chưa bị trừ tiền, hãy thử lại sau.',
  },
  REFUND_NOT_YET: { httpStatus: 409, message: 'Chưa tới hạn tự nhận lại tiền.' },
  INTERNAL_ERROR: { httpStatus: 500, message: 'Lỗi hệ thống. Hãy thử lại sau.' },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

// Mirrors the RefundReason enum in AskPayEscrow (contracts.md §6).
export const REFUND_REASONS = {
  NO_CITATION: 'Câu trả lời không có trích dẫn nên bạn không phải trả tiền.',
  INVALID_CITATION: 'Trích dẫn không khớp văn bản luật đã đăng ký trên blockchain, đã hoàn tiền.',
  CHECKER_REJECTED:
    'Trích dẫn không đúng nguyên văn hoặc không liên quan tới câu hỏi, đã hoàn tiền.',
  ANSWER_FAILED: 'Hệ thống không trả lời được lúc này, đã hoàn tiền.',
  TIMEOUT: 'Quá thời hạn trả lời, tiền đã được trả lại.',
} as const;

export type RefundReasonCode = keyof typeof REFUND_REASONS;

export const refundReasonCodes = Object.keys(REFUND_REASONS) as [
  RefundReasonCode,
  ...RefundReasonCode[],
];
