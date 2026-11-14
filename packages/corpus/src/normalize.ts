// The one definition of "normalised text" for the law corpus (AP-01-AC02). The leaf hash (C2) and
// the checker's quote match (A3) must both go through this, or a quote that is visibly identical
// to the law can fail to match it.

// Order matters and is fixed by system-design §6: NFC first, then collapse every run of whitespace
// (newlines and no-break spaces included) to one space, then trim.
export function normalizeText(input: string): string {
  return input.normalize('NFC').replace(/\s+/gu, ' ').trim();
}
