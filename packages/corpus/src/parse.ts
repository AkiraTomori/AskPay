// Turns the raw vbpl.vn HTML of Bộ luật Lao động 2019 into a flat list of Khoản (AP-01-AC01).
//
// The parser is strict on purpose: the output feeds a Merkle root that is registered on-chain, so
// any line it cannot place throws instead of being guessed. Rules and the surprises they handle
// are documented in packages/corpus/raw/SOURCE.md.
import { normalizeText } from './normalize.js';

export interface Khoan {
  dieu: number;
  // 0 = text that belongs to the Điều as a whole: a Điều with no numbered Khoản, or the lead-in
  // paragraph before Khoản 1 (owner decision, 14/11/2026).
  khoan: number;
  dieuTitle: string;
  chuong: string;
  text: string;
}

interface OpenDieu {
  dieu: number;
  title: string;
  chuong: string;
  lead: string[];
  khoans: { khoan: number; parts: string[] }[];
}

interface State {
  chuong: string;
  chuongNumber: number;
  awaitingChuongName: string | null;
  current: OpenDieu | null;
  lastDieu: number;
  // Open “ minus closed ” quotation marks. Only Điều 219 quotes other laws.
  quoteDepth: number;
  finished: boolean;
  out: Khoan[];
}

const CHUONG = /^Chương ([IVXLC]+)(?: (\P{Ll}+))?$/u;
const MUC = /^Mục \d+\. \P{Ll}+$/u;
const DIEU = /^Điều (\d+)\. (.+)$/u;
const KHOAN = /^(\d+)\. (.+)$/u;
const ALL_CAPS = /^\P{Ll}+$/u;
// The promulgation clause that closes the law; what follows is signatures.
const LAW_END = /^Bộ luật này được Quốc hội .+ thông qua ngày .+$/u;
// \s does not match these, so normalisation would leave them inside the text and silently break
// quote matching later.
const INVISIBLE = /[­​-‍⁠﻿]/u;
const QUOTING_DIEU = 219;

export function extractParagraphs(html: string): string[] {
  if (INVISIBLE.test(html)) throw new Error('Raw HTML contains invisible characters');
  const paragraphs: string[] = [];
  for (const match of html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gu)) {
    // <br> becomes a space so "Chương II<br>VIỆC LÀM" does not glue into "Chương IIVIỆC LÀM".
    const stripped = (match[1] ?? '').replace(/<br\s*\/?>/giu, '\n').replace(/<[^>]*>/gu, '');
    const decoded = stripped.replace(/&nbsp;/gu, ' ');
    if (/&[#\w]+;/u.test(decoded)) throw new Error('Unhandled HTML entity in raw text');
    const text = normalizeText(decoded);
    if (text) paragraphs.push(text);
  }
  return paragraphs;
}

export function parseLaw(html: string): Khoan[] {
  const state: State = {
    chuong: '',
    chuongNumber: 0,
    awaitingChuongName: null,
    current: null,
    lastDieu: 0,
    quoteDepth: 0,
    finished: false,
    out: [],
  };
  for (const line of extractParagraphs(html)) {
    consumeLine(state, line);
    if (state.finished) break;
  }
  if (!state.finished) throw new Error('Law text ended before the closing clause');
  return state.out;
}

export function serializeKhoans(khoans: readonly Khoan[]): string {
  return `${JSON.stringify(khoans, null, 2)}\n`;
}

function consumeLine(state: State, line: string): void {
  if (state.awaitingChuongName !== null) return setChuongName(state, line);
  // Preamble: everything before Điều 1 is header. Only the chapter headings are tracked.
  if (state.lastDieu === 0) {
    startsChuongOrDieu(state, line);
    return;
  }
  if (LAW_END.test(line)) return finish(state);
  if (state.quoteDepth === 0 && (startsChuongOrDieu(state, line) || MUC.test(line))) return;
  addBodyLine(state, line);
}

// Returns true when the line was a Chương or Điều heading and has been handled.
function startsChuongOrDieu(state: State, line: string): boolean {
  const chuong = CHUONG.exec(line);
  if (chuong) {
    closeDieu(state);
    const number = romanToInt(chuong[1] ?? '');
    if (number !== state.chuongNumber + 1) throw new Error(`Chương out of order: ${line}`);
    state.chuongNumber = number;
    const name = chuong[2];
    state.chuong = `Chương ${chuong[1]}`;
    state.awaitingChuongName = name === undefined ? state.chuong : null;
    if (name !== undefined) state.chuong = `${state.chuong}. ${name}`;
    return true;
  }
  const dieu = DIEU.exec(line);
  if (dieu) {
    openDieu(state, Number(dieu[1]), dieu[2] ?? '');
    return true;
  }
  return false;
}

function setChuongName(state: State, name: string): void {
  if (!ALL_CAPS.test(name))
    throw new Error(`Chương ${state.chuongNumber} has no title line: ${name}`);
  state.chuong = `${state.awaitingChuongName}. ${name}`;
  state.awaitingChuongName = null;
}

function openDieu(state: State, dieu: number, title: string): void {
  closeDieu(state);
  if (dieu !== state.lastDieu + 1)
    throw new Error(`Điều out of order: expected ${state.lastDieu + 1}, got ${dieu}`);
  state.lastDieu = dieu;
  state.current = { dieu, title, chuong: state.chuong, lead: [], khoans: [] };
}

function addBodyLine(state: State, line: string): void {
  const dieu = state.current;
  if (dieu === null) throw new Error(`Text outside any Điều: ${line}`);
  const numbered = state.quoteDepth === 0 ? KHOAN.exec(line) : null;
  if (numbered) {
    const number = Number(numbered[1]);
    if (number !== dieu.khoans.length + 1) {
      throw new Error(
        `Điều ${dieu.dieu}: Khoản ${number} out of order (after ${dieu.khoans.length})`,
      );
    }
    dieu.khoans.push({ khoan: number, parts: [numbered[2] ?? ''] });
  } else {
    const target = dieu.khoans.at(-1)?.parts ?? dieu.lead;
    target.push(line);
  }
  trackQuotes(state, dieu, line);
}

function trackQuotes(state: State, dieu: OpenDieu, line: string): void {
  state.quoteDepth += (line.match(/“/gu)?.length ?? 0) - (line.match(/”/gu)?.length ?? 0);
  if (state.quoteDepth < 0) throw new Error(`Điều ${dieu.dieu}: unbalanced closing quote`);
  if (state.quoteDepth > 0 && dieu.dieu !== QUOTING_DIEU) {
    throw new Error(
      `Điều ${dieu.dieu}: unexpected quotation mark; only Điều ${QUOTING_DIEU} quotes other laws`,
    );
  }
}

function closeDieu(state: State): void {
  const dieu = state.current;
  if (dieu === null) return;
  if (state.quoteDepth !== 0) throw new Error(`Điều ${dieu.dieu}: quotation not closed`);
  state.current = null;
  const base = { dieu: dieu.dieu, dieuTitle: dieu.title, chuong: dieu.chuong };
  if (dieu.lead.length === 0 && dieu.khoans.length === 0)
    throw new Error(`Điều ${dieu.dieu} is empty`);
  // The single place that decides how a lead-in is stored. Flip it here if the owner changes the
  // rule; the rest of the pipeline only sees Khoản numbers.
  if (dieu.lead.length > 0)
    state.out.push({ ...base, khoan: 0, text: normalizeText(dieu.lead.join(' ')) });
  for (const { khoan, parts } of dieu.khoans) {
    state.out.push({ ...base, khoan, text: normalizeText(parts.join(' ')) });
  }
}

function finish(state: State): void {
  closeDieu(state);
  state.finished = true;
}

function romanToInt(roman: string): number {
  const values: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 };
  let total = 0;
  for (let i = 0; i < roman.length; i += 1) {
    const value = values[roman[i] ?? ''] ?? 0;
    const next = values[roman[i + 1] ?? ''] ?? 0;
    total += value < next ? -value : value;
  }
  return total;
}
