// BM25 over Vietnamese syllables plus syllable bigrams (system-design §5.2, T-05). Vietnamese
// syllables are space-separated, so no segmenter is needed; bigrams let "làm thêm giờ" match as a
// phrase rather than as three unrelated words. Diacritics are kept: they separate words.

const K1 = 1.2;
const B = 0.75;
// Counting a title term this many times is what "tiêu đề Điều ×2" means in the design.
export const TITLE_WEIGHT = 2;

export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  // Split on punctuation first so a bigram never spans a clause boundary.
  for (const clause of text
    .normalize('NFC')
    .toLowerCase()
    .split(/[^\p{L}\p{M}\p{N}\s]+/u)) {
    const syllables = clause.split(/\s+/).filter(Boolean);
    tokens.push(...syllables);
    for (let index = 0; index + 1 < syllables.length; index += 1) {
      tokens.push(`${syllables[index]} ${syllables[index + 1]}`);
    }
  }
  return tokens;
}

export interface Bm25Document {
  title: string;
  text: string;
}

export interface Bm25Hit {
  index: number;
  score: number;
}

export interface Bm25Index {
  search(query: string): Bm25Hit[];
}

export function createBm25Index(documents: readonly Bm25Document[]): Bm25Index {
  const termFrequencies = documents.map((document) => {
    const counts = new Map<string, number>();
    for (const token of tokenize(document.text)) counts.set(token, (counts.get(token) ?? 0) + 1);
    for (const token of tokenize(document.title)) {
      counts.set(token, (counts.get(token) ?? 0) + TITLE_WEIGHT);
    }
    return counts;
  });
  const lengths = termFrequencies.map((counts) => [...counts.values()].reduce((a, b) => a + b, 0));
  const averageLength = lengths.reduce((a, b) => a + b, 0) / Math.max(lengths.length, 1);

  const documentFrequency = new Map<string, number>();
  for (const counts of termFrequencies) {
    for (const token of counts.keys()) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }

  const inverseDocumentFrequency = (token: string): number => {
    const containing = documentFrequency.get(token) ?? 0;
    // The +1 keeps IDF positive even for a term found in most documents.
    return Math.log(1 + (documents.length - containing + 0.5) / (containing + 0.5));
  };

  return {
    search(query) {
      // A repeated query word adds no information about which Khoản matches.
      const queryTokens = new Set(tokenize(query));
      const hits: Bm25Hit[] = [];
      termFrequencies.forEach((counts, index) => {
        let score = 0;
        for (const token of queryTokens) {
          const frequency = counts.get(token);
          if (frequency === undefined) continue;
          const lengthNorm = 1 - B + (B * (lengths[index] ?? 0)) / (averageLength || 1);
          score +=
            inverseDocumentFrequency(token) *
            ((frequency * (K1 + 1)) / (frequency + K1 * lengthNorm));
        }
        if (score > 0) hits.push({ index, score });
      });
      return hits;
    },
  };
}
