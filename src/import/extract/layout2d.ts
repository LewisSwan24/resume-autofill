// Recursive bounded XY-Cut layout reconstruction for multi-column & hybrid banner+column PDFs.
import { findGutter, rowsOf, type Piece } from './lines';

const MAX_XY_DEPTH = 4;

const lowestY = (pieces: readonly Piece[]): number => pieces.reduce((m, p) => (p.y < m ? p.y : m), Infinity);
const highestY = (pieces: readonly Piece[]): number => pieces.reduce((m, p) => (p.y > m ? p.y : m), -Infinity);

/** Filter decorative full-width thin rule glyphs ("____", "----") that bridge columns without holding words. */
function isDecorativeRule(p: Piece, pageWidth: number): boolean {
  const t = p.text.trim();
  return t.length >= 4 && /^[_\-—–=─━]+$/.test(t) && p.width > pageWidth * 0.25;
}

/**
 * Find a horizontal split separating top full-width banner rows (name / headline / divider) from
 * two-column content underneath, even when the vertical gap is slightly tighter than 16pt.
 */
function findSpanningHeaderSplit(pieces: readonly Piece[], pageWidth: number): { top: Piece[]; bottom: Piece[] } | null {
  const rows = rowsOf([...pieces]);
  if (rows.length < 6) return null;

  // Test splitting after each top banner row (up to first 4 rows).
  const maxHeaderRows = Math.min(4, rows.length - 5);
  for (let cut = 1; cut <= maxHeaderRows; cut++) {
    const topPieces = rows.slice(0, cut).flat();
    const bottomPieces = rows.slice(cut).flat();
    const topMinY = lowestY(topPieces);
    const botMaxY = highestY(bottomPieces);
    const minFont = Math.min(...bottomPieces.map((p) => p.fontSize || 10));
    if (topMinY - botMaxY < Math.max(8, minFont * 0.9)) continue;
    // Only split if the lower region genuinely decomposes into two balanced columns!
    const cleanBottom = bottomPieces.filter((p) => !isDecorativeRule(p, pageWidth));
    if (findGutter(cleanBottom, pageWidth) !== null) {
      return { top: topPieces, bottom: bottomPieces };
    }
  }
  return null;
}

/** Recursively segment page pieces into reading-order blocks (top-to-bottom bands, left-to-right columns). */
export function segmentLayoutBlocks(pieces: readonly Piece[], pageWidth: number, depth = 0): Piece[][] {
  if (pieces.length === 0) return [];
  if (depth >= MAX_XY_DEPTH) return [[...pieces]];

  const cleanForGutter = pieces.filter((p) => !isDecorativeRule(p, pageWidth));
  const gutter = findGutter(cleanForGutter, pageWidth);
  if (gutter !== null) {
    const left = pieces.filter((p) => !isDecorativeRule(p, pageWidth) && p.x < gutter);
    const right = pieces.filter((p) => !isDecorativeRule(p, pageWidth) && p.x >= gutter);
    return [
      ...segmentLayoutBlocks(left, pageWidth, depth + 1),
      ...segmentLayoutBlocks(right, pageWidth, depth + 1),
    ];
  }

  const headerSplit = findSpanningHeaderSplit(pieces, pageWidth);
  if (headerSplit) {
    return [
      ...segmentLayoutBlocks(headerSplit.top, pageWidth, depth + 1),
      ...segmentLayoutBlocks(headerSplit.bottom, pageWidth, depth + 1),
    ];
  }

  return [[...pieces]];
}
