/**
 * Pure, zero-dependency ISO/IEC 18004 QR Code (Error Correction Level L, Byte Mode)
 * SVG matrix generator for printable SENA Event Hub booth standees.
 * Supports payloads up to 271 UTF-8 bytes across Versions 4, 6, 8, and 10.
 */

type VersionSpec = {
  version: number;
  totalDataBytes: number;
  ecBytesPerBlock: number;
  blocks: number[];
  align: number[];
  versionBits?: number;
};

const SPECS: VersionSpec[] = [
  { version: 4, totalDataBytes: 80, ecBytesPerBlock: 20, blocks: [80], align: [6, 26] },
  { version: 6, totalDataBytes: 136, ecBytesPerBlock: 18, blocks: [68, 68], align: [6, 34] },
  { version: 8, totalDataBytes: 194, ecBytesPerBlock: 24, blocks: [97, 97], align: [6, 24, 42], versionBits: 0x085bc },
  { version: 10, totalDataBytes: 274, ecBytesPerBlock: 18, blocks: [68, 68, 69, 69], align: [6, 28, 50], versionBits: 0x0a4d3 },
];

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
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a: number, b: number): number {
  return a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGenerator(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    const factor = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], factor);
    }
    poly = next;
  }
  return poly;
}

function rsRemainder(data: Uint8Array, degree: number): Uint8Array {
  const gen = rsGenerator(degree);
  const rem = new Uint8Array(degree);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ rem[0];
    rem.copyWithin(0, 1);
    rem[degree - 1] = 0;
    if (factor !== 0) {
      for (let j = 0; j < degree; j++) {
        rem[j] ^= gfMul(gen[j + 1], factor);
      }
    }
  }
  return rem;
}

export function encodeQrMatrix(text: string): boolean[][] {
  const bytes = new TextEncoder().encode(text);
  const spec = SPECS.find(s => bytes.length + 3 <= s.totalDataBytes) ?? SPECS[SPECS.length - 1];
  const maxPayload = spec.totalDataBytes - 3;
  const payload = bytes.length > maxPayload ? bytes.slice(0, maxPayload) : bytes;

  const bits: number[] = [];
  const pushBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };

  // Mode 0100 (Byte), length (8 bits for v1..9, 16 bits for v10+)
  pushBits(0b0100, 4);
  pushBits(payload.length, spec.version >= 10 ? 16 : 8);
  for (const b of payload) pushBits(b, 8);
  pushBits(0, Math.min(4, spec.totalDataBytes * 8 - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);

  const dataBytes = new Uint8Array(spec.totalDataBytes);
  for (let i = 0; i < bits.length / 8; i++) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i * 8 + j];
    dataBytes[i] = v;
  }
  const pads = [0xec, 0x11];
  for (let i = bits.length / 8, p = 0; i < spec.totalDataBytes; i++, p ^= 1) {
    dataBytes[i] = pads[p];
  }

  // Split into RS blocks and interleave
  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  let offset = 0;
  for (const len of spec.blocks) {
    const blk = dataBytes.slice(offset, offset + len);
    offset += len;
    dataBlocks.push(blk);
    ecBlocks.push(rsRemainder(blk, spec.ecBytesPerBlock));
  }

  const finalCodewords: number[] = [];
  const maxDataLen = Math.max(...spec.blocks);
  for (let i = 0; i < maxDataLen; i++) {
    for (const blk of dataBlocks) if (i < blk.length) finalCodewords.push(blk[i]);
  }
  for (let i = 0; i < spec.ecBytesPerBlock; i++) {
    for (const ec of ecBlocks) finalCodewords.push(ec[i]);
  }

  const size = spec.version * 4 + 17;
  const grid: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));
  const reserved: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));

  const setModule = (r: number, c: number, dark: boolean) => {
    if (r >= 0 && r < size && c >= 0 && c < size) {
      grid[r][c] = dark;
      reserved[r][c] = true;
    }
  };

  const placeFinder = (top: number, left: number) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const dark =
          r >= 0 &&
          r <= 6 &&
          c >= 0 &&
          c <= 6 &&
          (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
        setModule(top + r, left + c, dark);
      }
    }
  };

  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  for (let i = 8; i < size - 8; i++) {
    if (!reserved[6][i]) setModule(6, i, i % 2 === 0);
    if (!reserved[i][6]) setModule(i, 6, i % 2 === 0);
  }

  for (const r of spec.align) {
    for (const c of spec.align) {
      if (reserved[r][c]) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          setModule(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
        }
      }
    }
  }

  // Reserve format info & dark module
  for (let i = 0; i < 9; i++) {
    if (!reserved[8][i]) reserved[8][i] = true;
    if (!reserved[i][8]) reserved[i][8] = true;
  }
  for (let i = 0; i < 8; i++) {
    reserved[8][size - 1 - i] = true;
    reserved[size - 1 - i][8] = true;
  }
  setModule(size - 8, 8, true);

  if (spec.versionBits) {
    for (let i = 0; i < 18; i++) {
      const bit = ((spec.versionBits >>> i) & 1) === 1;
      const a = Math.floor(i / 3);
      const b = (i % 3) + size - 11;
      setModule(a, b, bit);
      setModule(b, a, bit);
    }
  }

  // Place data bits (Mask 0: (r + c) % 2 === 0)
  let bitIdx = 0;
  const totalBits = finalCodewords.length * 8;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      const r = upward ? size - 1 - vert : vert;
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        if (reserved[r][c]) continue;
        let dark = false;
        if (bitIdx < totalBits) {
          dark = ((finalCodewords[bitIdx >>> 3] >>> (7 - (bitIdx & 7))) & 1) === 1;
          bitIdx++;
        }
        if ((r + c) % 2 === 0) dark = !dark;
        grid[r][c] = dark;
      }
    }
    upward = !upward;
  }

  // Format bits for Level L (01) + Mask 0 (000) -> BCH + XOR 0x5412 = 0x77c4
  const formatBits = 0x77c4;
  for (let i = 0; i <= 5; i++) grid[8][i] = ((formatBits >>> i) & 1) === 1;
  grid[8][7] = ((formatBits >>> 6) & 1) === 1;
  grid[8][8] = ((formatBits >>> 7) & 1) === 1;
  grid[7][8] = ((formatBits >>> 8) & 1) === 1;
  for (let i = 9; i < 15; i++) grid[14 - i][8] = ((formatBits >>> i) & 1) === 1;

  for (let i = 0; i < 8; i++) grid[size - 1 - i][8] = ((formatBits >>> i) & 1) === 1;
  for (let i = 8; i < 15; i++) grid[8][size - 15 + i] = ((formatBits >>> i) & 1) === 1;

  return grid;
}
