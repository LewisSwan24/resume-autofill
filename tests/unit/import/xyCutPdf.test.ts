import { describe, expect, it } from 'vitest';
import { linesOfPage, type Piece } from '../../../src/import/extract/lines';

describe('XY-Cut 2D PDF layout reconstruction (linesOfPage)', () => {
  it('separates a tight spanning header and decorative rule above two columns without interleaving lines', () => {
    const pieces: Piece[] = [
      // Spanning top banner + tight 10pt gap + decorative full-width rule
      { text: 'Alex Chen - Senior Distributed Systems Engineer', x: 50, y: 780, width: 420, fontSize: 16 },
      { text: '________________________________________', x: 50, y: 766, width: 480, fontSize: 10 },
      // Left column (x = 50, width ~ 160)
      { text: 'Skills', x: 50, y: 750, width: 40, fontSize: 12 },
      { text: 'Rust & Go', x: 50, y: 734, width: 80, fontSize: 10 },
      { text: 'Kubernetes', x: 50, y: 718, width: 80, fontSize: 10 },
      { text: 'PostgreSQL', x: 50, y: 702, width: 80, fontSize: 10 },
      { text: 'Education', x: 50, y: 682, width: 70, fontSize: 12 },
      // Right column (x = 300, width ~ 220)
      { text: 'Experience', x: 300, y: 750, width: 80, fontSize: 12 },
      { text: 'CloudCore Inc', x: 300, y: 734, width: 100, fontSize: 10 },
      { text: 'Built consensus engine', x: 300, y: 718, width: 140, fontSize: 10 },
      { text: 'DataMesh Ltd', x: 300, y: 702, width: 100, fontSize: 10 },
      { text: 'Reduced tail latency', x: 300, y: 682, width: 130, fontSize: 10 },
    ];

    const lines = linesOfPage(pieces, 1, 600).map((l) => l.text);
    const idx = (s: string) => lines.findIndex((l) => l.includes(s));

    // Banner read before columns
    expect(idx('Alex Chen')).toBe(0);
    // Entire left column precedes right column
    expect(idx('Skills')).toBeLessThan(idx('Education'));
    expect(idx('Education')).toBeLessThan(idx('Experience'));
    // Zero horizontal column mixing on the same line
    expect(lines.some((l) => l.includes('Rust') && l.includes('CloudCore'))).toBe(false);
    expect(lines.some((l) => l.includes('Kubernetes') && l.includes('consensus'))).toBe(false);
  });
});
