// Finds the Khoản that may answer a question. The answer step may cite only what is returned here
// (AP-04-AC02), so this list is the boundary of what the LLM is allowed to quote.
import { createBm25Index } from './bm25.js';

export const RETRIEVAL_TOP_K = 8;

// One searchable unit: a Khoản, or a whole Điều when it has none (khoan = 0).
// Shape is what the corpus parser (C1) is expected to produce; align it when C1 lands.
export interface RetrievalDoc {
  dieu: number;
  khoan: number;
  dieuTitle: string;
  text: string;
}

export interface Candidate extends RetrievalDoc {
  id: string;
  score: number;
}

export function createRetrieval(
  docs: readonly RetrievalDoc[],
  options: { topK?: number } = {},
): (question: string) => Candidate[] {
  const topK = options.topK ?? RETRIEVAL_TOP_K;

  const seen = new Set<string>();
  for (const doc of docs) {
    const key = `${doc.dieu}.${doc.khoan}`;
    if (seen.has(key)) throw new Error(`Duplicate Điều/Khoản in corpus: ${key}`);
    seen.add(key);
  }

  // Sorting up front makes tie-breaking independent of input order.
  const ordered = [...docs].sort((a, b) => a.dieu - b.dieu || a.khoan - b.khoan);
  const index = createBm25Index(ordered.map(({ dieuTitle, text }) => ({ title: dieuTitle, text })));

  return (question) =>
    index
      .search(question)
      // Equal scores keep corpus order: hits arrive in ascending index and sort is stable.
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, topK)
      .flatMap(({ index: position, score }, rank) => {
        const doc = ordered[position];
        return doc ? [{ ...doc, id: `C${rank + 1}`, score }] : [];
      });
}
