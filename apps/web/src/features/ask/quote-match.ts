// Finds a checker-accepted quote inside the law text it was cut from (design W3 §6).
// `indexOf` is not enough: the quote went through normalizeText (NFC, every whitespace run -> one
// space, trimmed) and the text still has its line breaks between points a), b), c).
//
// The web does not import @askpay/corpus. This reads the same rule from the matching side: a quote
// word sequence separated by `\s+`. Test W3-E14 locks it to normalizeText on the real corpus.
export type QuoteRange = { start: number; end: number };

const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/gu;

export function locateQuote(text: string, quote: string): QuoteRange | undefined {
  const words = quote.normalize('NFC').split(/\s+/u).filter(Boolean);
  if (words.length === 0) return undefined;
  const pattern = new RegExp(
    words.map((word) => word.replace(REGEX_SPECIALS, '\\$&')).join('\\s+'),
    'u',
  );
  const match = pattern.exec(text.normalize('NFC'));
  // The range indexes the NFC form of `text`; that is the string the card displays.
  return match ? { start: match.index, end: match.index + match[0].length } : undefined;
}
