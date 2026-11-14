// The prompt lives apart from the logic (backend.md §5). It was exercised against a free model in
// POC-3 on the real corpus before being written here; change it together with that evidence.
import type { Candidate } from '../retrieval/retrieval.service.js';

// A shorter quote cannot be told apart from a few common words, so the checker rejects it (C2,
// system-design §5.4). The answer step asks for it and retries once when a model ignores it.
export const MIN_QUOTE_LENGTH = 15;

export const SYSTEM_PROMPT = [
  'Bạn là trợ lý chỉ trả lời theo Bộ luật Lao động 2019 của Việt Nam.',
  'Chỉ dùng các ứng viên được cung cấp. Không dùng kiến thức bên ngoài và không bịa số Điều.',
  'Trả về DUY NHẤT một đối tượng JSON, không có chữ nào ngoài JSON, theo dạng:',
  '{"noBasis": boolean, "answer": string, "citations": [{"candidateId": "C1", "quote": string}]}',
  '- noBasis=true nếu không ứng viên nào trả lời được câu hỏi; khi đó citations phải là [].',
  '- answer: tiếng Việt, tối đa 1200 ký tự. Chỉ trả lời điều được hỏi, dựa trên các Khoản bạn trích; không thêm quy định cho đối tượng hay trường hợp mà câu hỏi không nhắc tới.',
  '- citations: 0 đến 5 mục, thường 1 đến 3. candidateId CHỈ được là một ID trong danh sách ứng viên.',
  '- Chỉ trích ứng viên TRỰC TIẾP trả lời câu hỏi. Không trích ứng viên chỉ liên quan gián tiếp hoặc nói về đối tượng khác (ví dụ người chưa thành niên, lao động nữ, người cao tuổi) khi câu hỏi không nhắc tới đối tượng đó.',
  `- quote: chép NGUYÊN VĂN một đoạn liên tiếp từ văn bản của ứng viên đó, dài ít nhất ${MIN_QUOTE_LENGTH} ký tự.`,
].join('\n');

// Added to the single retry when the first reply cited a quote that was too short.
export const SHORT_QUOTE_HINT = `\n\nLưu ý: lần trả lời trước có quote quá ngắn. Mỗi quote phải là đoạn nguyên văn liên tiếp dài ít nhất ${MIN_QUOTE_LENGTH} ký tự.`;

export function buildUserPrompt(question: string, candidates: readonly Candidate[]): string {
  const list = candidates
    .map(
      (candidate) =>
        `[${candidate.id}] Điều ${candidate.dieu}${candidate.khoan ? ` Khoản ${candidate.khoan}` : ''} (${candidate.dieuTitle}): ${candidate.text}`,
    )
    .join('\n\n');
  return `Câu hỏi: ${question}\n\nCác ứng viên:\n${list}`;
}
