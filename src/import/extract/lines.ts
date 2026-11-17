// From positioned pieces of text to lines in reading order, with two columns read one after the other.
import type { TextLine } from './types';

export interface Piece {
  text: string;
  x: number;
  /** Baseline, from the bottom of the page: a larger y is higher up. */
  y: number;
  width: number;
  fontSize: number;
}

/** A gap this many times the font size separates two cells on a line. */
const CELL_GAP = 2;
/** A gap this many times the font size is a space between words. */
const WORD_GAP = 0.2;
const BIN = 2;
/** The narrowest gutter worth calling one, in points. */
const MIN_GUTTER = 8;
/** A column has at least this many lines. */
const MIN_COLUMN_LINES = 4;
/** Most lines of a real column start at the same x. A right-aligned date does not. */
const MIN_ALIGNED = 0.5;
const ALIGN_TOLERANCE = 3;
/** The widest page the PDF format allows. A file that says more is not describing a page. */
const MAX_PAGE_WIDTH = 14_400;
/** Far more text than fits on a page anyone could read. The rest of the page is not read. */
const MAX_PIECES_PER_PAGE = 20_000;

const lowest = (values: number[]): number => values.reduce((a, b) => (b < a ? b : a), Infinity);
const highest = (values: number[]): number => values.reduce((a, b) => (b > a ? b : a), -Infinity);

function rowsOf(pieces: Piece[]): Piece[][] {
  const sorted = [...pieces].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: Piece[][] = [];
  for (const piece of sorted) {
    const row = rows[rows.length - 1];
    const tolerance = Math.max(piece.fontSize, 1) * 0.5;
    if (row && Math.abs(row[0]!.y - piece.y) <= tolerance) row.push(piece);
    else rows.push([piece]);
  }
  return rows;
}

function lineOf(row: Piece[], page: number): TextLine {
  const pieces = [...row].sort((a, b) => a.x - b.x);
  const cells: string[] = [];
  let current = '';
  let end = pieces[0]!.x;
  let size = 0;
  for (const p of pieces) {
    const gap = p.x - end;
    size = Math.max(size, p.fontSize);
    if (current && gap > p.fontSize * CELL_GAP) {
      cells.push(current.trim());
      current = '';
    } else if (current && gap > p.fontSize * WORD_GAP && !current.endsWith(' ') && !p.text.startsWith(' ')) {
      current += ' ';
    }
    current += p.text;
    end = Math.max(end, p.x + p.width);
  }
  if (current.trim()) cells.push(current.trim());
  return { text: cells.join(' '), cells, page, fontSize: Math.round(size * 10) / 10 };
}

/** The middle of the widest strip no piece crosses, if each side of it reads as a column. */
export function findGutter(pieces: Piece[], pageWidth: number): number | null {
  if (!(pageWidth > 0 && pageWidth <= MAX_PAGE_WIDTH)) return null;
  const count = Math.ceil(pageWidth / BIN) + 1;
  // Where each piece starts and stops, added up afterwards: a piece as wide as the page costs no more than a short one.
  const changes = new Int32Array(count + 1);
  const left = lowest(pieces.map((p) => p.x));
  const right = highest(pieces.map((p) => p.x + p.width));
  for (const p of pieces) {
    const first = Math.max(Math.floor(p.x / BIN), 0);
    const last = Math.min(Math.floor((p.x + p.width) / BIN), count - 1);
    if (!(first <= last)) continue;
    changes[first]! += 1;
    changes[last + 1]! -= 1;
  }
  let best: { from: number; size: number } | null = null;
  let from = -1;
  let covering = 0;
  for (let b = 0; b < count; b++) {
    covering += changes[b]!;
    const inside = b * BIN > left && b * BIN < right;
    if (inside && covering === 0) {
      if (from < 0) from = b;
      const size = (b - from + 1) * BIN;
      if (!best || size > best.size) best = { from, size };
    } else {
      from = -1;
    }
  }
  if (!best || best.size < MIN_GUTTER) return null;
  const gutter = best.from * BIN + best.size / 2;
  const isColumn = (side: Piece[]): boolean => {
    const rows = rowsOf(side);
    if (rows.length < MIN_COLUMN_LINES) return false;
    const starts = rows.map((r) => lowest(r.map((p) => p.x)));
    const edge = lowest(starts);
    return starts.filter((x) => x - edge <= ALIGN_TOLERANCE).length / starts.length >= MIN_ALIGNED;
  };
  return isColumn(pieces.filter((p) => p.x < gutter)) && isColumn(pieces.filter((p) => p.x >= gutter)) ? gutter : null;
}

const MIN_BAND_GAP = 16;

/** Split a page into vertical bands when a wide gap separates a full-width banner from multi-column content below. */
function bandsOf(pieces: Piece[]): Piece[][] {
  const rows = rowsOf(pieces);
  if (rows.length < MIN_COLUMN_LINES + 1) return [pieces];
  const bands: Piece[][] = [];
  let current: Piece[] = [...rows[0]!];
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1]!;
    const next = rows[i]!;
    const prevY = lowest(prev.map((p) => p.y));
    const nextY = highest(next.map((p) => p.y));
    const maxFont = Math.max(...prev.map((p) => p.fontSize), ...next.map((p) => p.fontSize), 10);
    if (prevY - nextY > Math.max(MIN_BAND_GAP, maxFont * 1.6)) {
      bands.push(current);
      current = [...next];
    } else {
      current.push(...next);
    }
  }
  bands.push(current);
  return bands;
}

function readBand(band: Piece[], page: number, pageWidth: number): TextLine[] {
  const gutter = findGutter(band, pageWidth);
  const parts = gutter === null ? [band] : [band.filter((p) => p.x < gutter), band.filter((p) => p.x >= gutter)];
  return parts.flatMap((part) => rowsOf(part).map((row) => lineOf(row, page)));
}

export function linesOfPage(pieces: Piece[], page: number, pageWidth: number): TextLine[] {
  const real = pieces.filter((p) => p.text.trim()).slice(0, MAX_PIECES_PER_PAGE);
  if (real.length === 0) return [];
  const fullGutter = findGutter(real, pageWidth);
  if (fullGutter !== null) return readBand(real, page, pageWidth);

  const bands = bandsOf(real);
  if (bands.length === 1) return readBand(real, page, pageWidth);
  // If no individual band is multi-column, keep original single-band row order so spacing doesn't re-group lines.
  const hasColumnBand = bands.some((b) => findGutter(b, pageWidth) !== null);
  if (!hasColumnBand) return readBand(real, page, pageWidth);
  return bands.flatMap((b) => readBand(b, page, pageWidth));
}
