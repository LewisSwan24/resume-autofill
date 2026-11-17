// Pure TypeScript, zero-dependency ISO/IEC 18004 QR Code (Byte Mode, ECC L) SVG renderer + static image reader.

// GF(256) with primitive polynomial 0x11d (QR standard)
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255]!;
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a]! + GF_LOG[b]!]!;
}

function rsGeneratorPoly(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    const factor = GF_EXP[i]!;
    for (let j = 0; j < poly.length; j++) {
      next[j]! ^= poly[j]!;
      next[j + 1]! ^= gfMul(poly[j]!, factor);
    }
    poly = next;
  }
  return poly;
}

function rsRemainder(data: Uint8Array, ecLen: number): Uint8Array {
  const gen = rsGeneratorPoly(ecLen);
  const res = new Uint8Array(ecLen);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i]! ^ res[0]!;
    res.copyWithin(0, 1);
    res[ecLen - 1] = 0;
    for (let j = 0; j < ecLen; j++) {
      res[j]! ^= gfMul(gen[j + 1]!, factor);
    }
  }
  return res;
}

interface VersionSpec {
  totalCodewords: number;
  ecPerBlock: number;
  g1Blocks: number;
  g1Data: number;
  g2Blocks: number;
  g2Data: number;
}

// Level L table for Versions 1..20 (supports up to ~858 UTF-8 bytes, ample for compact local SDP).
const VERSIONS_L: readonly VersionSpec[] = [
  { totalCodewords: 26, ecPerBlock: 7, g1Blocks: 1, g1Data: 19, g2Blocks: 0, g2Data: 0 }, // V1
  { totalCodewords: 44, ecPerBlock: 10, g1Blocks: 1, g1Data: 34, g2Blocks: 0, g2Data: 0 }, // V2
  { totalCodewords: 70, ecPerBlock: 15, g1Blocks: 1, g1Data: 55, g2Blocks: 0, g2Data: 0 }, // V3
  { totalCodewords: 100, ecPerBlock: 20, g1Blocks: 1, g1Data: 80, g2Blocks: 0, g2Data: 0 }, // V4
  { totalCodewords: 134, ecPerBlock: 26, g1Blocks: 1, g1Data: 108, g2Blocks: 0, g2Data: 0 }, // V5
  { totalCodewords: 172, ecPerBlock: 18, g1Blocks: 2, g1Data: 68, g2Blocks: 0, g2Data: 0 }, // V6
  { totalCodewords: 196, ecPerBlock: 20, g1Blocks: 2, g1Data: 78, g2Blocks: 0, g2Data: 0 }, // V7
  { totalCodewords: 242, ecPerBlock: 24, g1Blocks: 2, g1Data: 97, g2Blocks: 0, g2Data: 0 }, // V8
  { totalCodewords: 292, ecPerBlock: 30, g1Blocks: 2, g1Data: 116, g2Blocks: 0, g2Data: 0 }, // V9
  { totalCodewords: 346, ecPerBlock: 18, g1Blocks: 2, g1Data: 68, g2Blocks: 2, g2Data: 69 }, // V10
  { totalCodewords: 404, ecPerBlock: 20, g1Blocks: 4, g1Data: 81, g2Blocks: 0, g2Data: 0 }, // V11
  { totalCodewords: 466, ecPerBlock: 24, g1Blocks: 2, g1Data: 92, g2Blocks: 2, g2Data: 93 }, // V12
  { totalCodewords: 532, ecPerBlock: 26, g1Blocks: 4, g1Data: 107, g2Blocks: 0, g2Data: 0 }, // V13
  { totalCodewords: 581, ecPerBlock: 30, g1Blocks: 3, g1Data: 115, g2Blocks: 1, g2Data: 116 }, // V14
  { totalCodewords: 655, ecPerBlock: 22, g1Blocks: 5, g1Data: 87, g2Blocks: 1, g2Data: 88 }, // V15
  { totalCodewords: 733, ecPerBlock: 24, g1Blocks: 5, g1Data: 98, g2Blocks: 1, g2Data: 99 }, // V16
  { totalCodewords: 815, ecPerBlock: 28, g1Blocks: 1, g1Data: 107, g2Blocks: 5, g2Data: 108 }, // V17
  { totalCodewords: 901, ecPerBlock: 30, g1Blocks: 5, g1Data: 120, g2Blocks: 1, g2Data: 121 }, // V18
  { totalCodewords: 991, ecPerBlock: 28, g1Blocks: 3, g1Data: 113, g2Blocks: 4, g2Data: 114 }, // V19
  { totalCodewords: 1085, ecPerBlock: 28, g1Blocks: 3, g1Data: 107, g2Blocks: 5, g2Data: 108 }, // V20
];

const ALIGNMENT_CENTERS: readonly number[][] = [
  [],
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
  [6, 30, 54],
  [6, 32, 58],
  [6, 34, 62],
  [6, 26, 46, 66],
  [6, 26, 48, 70],
  [6, 26, 50, 74],
  [6, 30, 54, 78],
  [6, 30, 56, 82],
  [6, 30, 58, 86],
  [6, 34, 62, 90],
];

function dataCapacityBytes(v: number, spec: VersionSpec): number {
  const totalDataCodewords = spec.g1Blocks * spec.g1Data + spec.g2Blocks * spec.g2Data;
  const headerBits = 4 + (v >= 10 ? 16 : 8);
  return Math.floor((totalDataCodewords * 8 - headerBits) / 8);
}

function chooseVersion(byteLen: number): number {
  for (let v = 1; v <= VERSIONS_L.length; v++) {
    if (byteLen <= dataCapacityBytes(v, VERSIONS_L[v - 1]!)) return v;
  }
  throw new Error(`QR payload too large (${byteLen} bytes)`);
}

function encodeCodewords(bytes: Uint8Array, version: number): Uint8Array {
  const spec = VERSIONS_L[version - 1]!;
  const totalData = spec.g1Blocks * spec.g1Data + spec.g2Blocks * spec.g2Data;
  const bits: number[] = [];
  const pushBits = (val: number, count: number) => {
    for (let i = count - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };

  pushBits(0b0100, 4); // Byte mode
  pushBits(bytes.length, version >= 10 ? 16 : 8);
  for (const b of bytes) pushBits(b, 8);
  const maxBits = totalData * 8;
  pushBits(0, Math.min(4, maxBits - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);
  const padBytes = [0xec, 0x11];
  let p = 0;
  while (bits.length < maxBits) {
    pushBits(padBytes[p % 2]!, 8);
    p++;
  }

  const dataBytes = new Uint8Array(totalData);
  for (let i = 0; i < totalData; i++) {
    let b = 0;
    for (let k = 0; k < 8; k++) b = (b << 1) | bits[i * 8 + k]!;
    dataBytes[i] = b;
  }

  const blocks: { data: Uint8Array; ec: Uint8Array }[] = [];
  let off = 0;
  for (let i = 0; i < spec.g1Blocks; i++) {
    const slice = dataBytes.subarray(off, off + spec.g1Data);
    blocks.push({ data: slice, ec: rsRemainder(slice, spec.ecPerBlock) });
    off += spec.g1Data;
  }
  for (let i = 0; i < spec.g2Blocks; i++) {
    const slice = dataBytes.subarray(off, off + spec.g2Data);
    blocks.push({ data: slice, ec: rsRemainder(slice, spec.ecPerBlock) });
    off += spec.g2Data;
  }

  const out: number[] = [];
  const maxDataLen = Math.max(spec.g1Data, spec.g2Data);
  for (let col = 0; col < maxDataLen; col++) {
    for (const blk of blocks) {
      if (col < blk.data.length) out.push(blk.data[col]!);
    }
  }
  for (let col = 0; col < spec.ecPerBlock; col++) {
    for (const blk of blocks) out.push(blk.ec[col]!);
  }
  return new Uint8Array(out);
}

function drawFormatInfo(modules: Uint8Array, isFunc: Uint8Array, size: number, mask: number): void {
  // Error correction level L (01) + 3-bit mask -> 5 bits -> BCH(15, 5)
  const data = (0b01 << 3) | mask;
  let rem = data << 10;
  for (let i = 14; i >= 10; i--) {
    if ((rem >>> i) & 1) rem ^= 0b10100110111 << (i - 10);
  }
  const bits = ((data << 10) | rem) ^ 0b101010000010010;
  for (let i = 0; i < 15; i++) {
    const dark = (bits >>> i) & 1;
    // Vertical copy + horizontal copy around top-left finder
    if (i < 6) modules[i * size + 8] = dark;
    else if (i < 8) modules[(i + 1) * size + 8] = dark;
    else modules[(size - 15 + i) * size + 8] = dark;

    if (i < 8) modules[8 * size + (size - 1 - i)] = dark;
    else if (i < 9) modules[8 * size + 7] = dark;
    else modules[8 * size + (14 - i)] = dark;
  }
  modules[(size - 8) * size + 8] = 1;
  isFunc[(size - 8) * size + 8] = 1;
}

function drawVersionInfo(modules: Uint8Array, isFunc: Uint8Array, size: number, version: number): void {
  if (version < 7) return;
  let rem = version << 12;
  for (let i = 17; i >= 12; i--) {
    if ((rem >>> i) & 1) rem ^= 0b1111100100101 << (i - 12);
  }
  const bits = (version << 12) | rem;
  for (let i = 0; i < 18; i++) {
    const dark = (bits >>> i) & 1;
    const a = size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    modules[b * size + a] = dark;
    modules[a * size + b] = dark;
    isFunc[b * size + a] = 1;
    isFunc[a * size + b] = 1;
  }
}

export interface QrMatrix {
  size: number;
  /** Row-major booleans (1 = dark, 0 = light). */
  modules: Uint8Array;
}

/** Encode a UTF-8 string into an ISO/IEC 18004 QR Code matrix (ECC Level L). */
export function encodeQrMatrix(text: string): QrMatrix {
  const bytes = new TextEncoder().encode(text);
  const version = chooseVersion(bytes.length);
  const size = version * 4 + 17;
  const codewords = encodeCodewords(bytes, version);

  const isFunc = new Uint8Array(size * size);
  const base = new Uint8Array(size * size);

  const setFn = (r: number, c: number, dark: number) => {
    if (r < 0 || r >= size || c < 0 || c >= size) return;
    base[r * size + c] = dark;
    isFunc[r * size + c] = 1;
  };

  const drawFinder = (top: number, left: number) => {
    for (let dy = -1; dy <= 7; dy++) {
      for (let dx = -1; dx <= 7; dx++) {
        const inside = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6;
        const border = dx === 0 || dx === 6 || dy === 0 || dy === 6;
        const core = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4;
        setFn(top + dy, left + dx, inside && (border || core) ? 1 : 0);
      }
    }
  };
  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    setFn(6, i, i % 2 === 0 ? 1 : 0);
    setFn(i, 6, i % 2 === 0 ? 1 : 0);
  }

  // Alignment patterns
  const centers = ALIGNMENT_CENTERS[version] ?? [];
  for (const cy of centers) {
    for (const cx of centers) {
      if ((cy === 6 && cx === 6) || (cy === 6 && cx === size - 7) || (cy === size - 7 && cx === 6)) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const dark = Math.max(Math.abs(dx), Math.abs(dy)) === 2 || (dx === 0 && dy === 0) ? 1 : 0;
          setFn(cy + dy, cx + dx, dark);
        }
      }
    }
  }

  // Reserve format info cells
  for (let i = 0; i < 9; i++) {
    if (i !== 6) {
      isFunc[8 * size + i] = 1;
      isFunc[i * size + 8] = 1;
    }
  }
  for (let i = 0; i < 8; i++) {
    isFunc[8 * size + (size - 1 - i)] = 1;
    isFunc[(size - 1 - i) * size + 8] = 1;
  }
  isFunc[(size - 8) * size + 8] = 1;
  drawVersionInfo(base, isFunc, size, version);

  // Place data bits zig-zag
  let bitIdx = 0;
  const totalBits = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        const upward = ((right + 1) & 2) === 0;
        const r = upward ? size - 1 - vert : vert;
        if (!isFunc[r * size + c] && bitIdx < totalBits) {
          const bit = (codewords[bitIdx >> 3]! >>> (7 - (bitIdx & 7))) & 1;
          base[r * size + c] = bit;
          bitIdx++;
        }
      }
    }
  }

  // Evaluate 8 masks with run + 2x2 penalty
  let bestMask = 0;
  let bestScore = Infinity;
  let bestModules = base;

  const maskFn = (m: number, r: number, c: number): boolean => {
    switch (m) {
      case 0: return (r + c) % 2 === 0;
      case 1: return r % 2 === 0;
      case 2: return c % 3 === 0;
      case 3: return (r + c) % 3 === 0;
      case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
      case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
      case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
      default: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    }
  };

  for (let m = 0; m < 8; m++) {
    const candidate = base.slice();
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (!isFunc[r * size + c] && maskFn(m, r, c)) candidate[r * size + c]! ^= 1;
      }
    }
    drawFormatInfo(candidate, isFunc, size, m);

    let penalty = 0;
    for (let r = 0; r < size; r++) {
      let runLen = 1;
      for (let c = 1; c < size; c++) {
        if (candidate[r * size + c] === candidate[r * size + c - 1]) {
          runLen++;
          if (runLen === 5) penalty += 3;
          else if (runLen > 5) penalty += 1;
        } else {
          runLen = 1;
        }
      }
    }
    for (let c = 0; c < size; c++) {
      let runLen = 1;
      for (let r = 1; r < size; r++) {
        if (candidate[r * size + c] === candidate[(r - 1) * size + c]) {
          runLen++;
          if (runLen === 5) penalty += 3;
          else if (runLen > 5) penalty += 1;
        } else {
          runLen = 1;
        }
      }
    }
    for (let r = 0; r < size - 1; r++) {
      for (let c = 0; c < size - 1; c++) {
        const v = candidate[r * size + c];
        if (v === candidate[r * size + c + 1] && v === candidate[(r + 1) * size + c] && v === candidate[(r + 1) * size + c + 1]) {
          penalty += 3;
        }
      }
    }
    if (penalty < bestScore) {
      bestScore = penalty;
      bestMask = m;
      bestModules = candidate;
    }
  }
  void bestMask;

  return { size, modules: bestModules };
}

/** Render a UTF-8 string into an offline SVG QR code (`currentColor` foreground on quiet background). */
export function renderQrSvg(text: string, label = 'QR Code'): string {
  const { size, modules } = encodeQrMatrix(text);
  const quiet = 2;
  const total = size + quiet * 2;
  const paths: string[] = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (modules[r * size + c]) {
        paths.push(`M${c + quiet},${r + quiet}h1v1h-1z`);
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" role="img" aria-label="${label.replaceAll('"', '&quot;')}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="#ffffff"/><path d="${paths.join('')}" fill="#000000"/></svg>`;
}

/** Decode a QR code from a locally chosen image file using the browser's built-in BarcodeDetector (no camera permissions). */
export async function decodeQrImageFile(file: Blob): Promise<string | null> {
  const Detector = (globalThis as unknown as { BarcodeDetector?: new (opts: { formats: string[] }) => { detect: (img: ImageBitmap) => Promise<Array<{ rawValue?: string }>> } }).BarcodeDetector;
  if (!Detector || typeof createImageBitmap !== 'function') return null;
  const bitmap = await createImageBitmap(file);
  try {
    const detector = new Detector({ formats: ['qr_code'] });
    const hits = await detector.detect(bitmap);
    return hits[0]?.rawValue ?? null;
  } finally {
    bitmap.close();
  }
}
