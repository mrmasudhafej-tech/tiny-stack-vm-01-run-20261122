// Tiny stack VM: faithful interpreter of the ISA v1 (Node 22, stdlib only).
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const STACK_MAX = 256;
const CALLS_MAX = 64;
const STEP_LIMIT = 1000000;
const OUTPUT_MAX = 65536;

// Immediate bytes for a known opcode, or -1 for an unknown one.
function immOf(op) {
  if (op === 0x01) return 1;
  if (op === 0x02) return 4;
  if (op >= 0x30 && op <= 0x33) return 2;
  if (op <= 0x07 || (op >= 0x10 && op <= 0x22) || op === 0x34 || op === 0x40 || op === 0x41 || (op >= 0x50 && op <= 0x53)) return 0;
  return -1;
}
// Pops/pushes encoded as pops*256+pushes, checked before each trap/effect.
function shape(op) {
  if (op === 0x01 || op === 0x02 || op === 0x52) return 1;
  if (op === 0x04) return 258;
  if (op === 0x06) return 515;
  if (op === 0x05) return 514;
  if (op === 0x07) return 771;
  if (op === 0x41) return 512;
  if ((op >= 0x10 && op <= 0x16) || (op >= 0x18 && op <= 0x1e && op !== 0x1b) || (op >= 0x20 && op <= 0x22)) return 513;
  if (op === 0x03 || op === 0x17 || op === 0x1b || op === 0x31 || op === 0x32 || op === 0x40 || op === 0x50 || op === 0x51 || op === 0x53) return 256;
  return 0;
}

// Decimal length of v, for the output-limit check before writing it.
function decLen(v) { return String(v).length; }
function writeDecimal(out, olen, v) {
  const s = String(v);
  for (let i = 0; i < s.length; i++) out[olen++] = s.charCodeAt(i);
  return olen;
}

function run(p, inp) {
  const n = p.length;
  const D = new Int32Array(STACK_MAX);
  const C = new Int32Array(CALLS_MAX);
  const M = new Int32Array(256);
  const out = new Uint8Array(OUTPUT_MAX);
  let sp = 0, csp = 0, olen = 0, inPos = 0, pc = 0, steps = 0;
  for (;;) {
    if (steps === STEP_LIMIT) return { out: out.slice(0, olen), exit: 10 };
    if (pc < 0 || pc >= n) return { out: out.slice(0, olen), exit: 9 };
    const op = p[pc];
    const imm = immOf(op);
    if (imm < 0) return { out: out.slice(0, olen), exit: 5 };
    if (pc + imm >= n) return { out: out.slice(0, olen), exit: 9 };
    steps++;
    const next = pc + 1 + imm;
    const sh = shape(op), pops = sh >> 8, pushes = sh & 255;
    if (sp < pops) return { out: out.slice(0, olen), exit: 2 };
    if (sp - pops + pushes > STACK_MAX) return { out: out.slice(0, olen), exit: 3 };
    pc = next;
    switch (op) {
      case 0x00: return { out: out.slice(0, olen), exit: 0 };
      case 0x01: D[sp++] = (p[pc - 1] << 24) >> 24; break;
      case 0x02: D[sp++] = p[pc - 4] | (p[pc - 3] << 8) | (p[pc - 2] << 16) | (p[pc - 1] << 24); break;
      case 0x03: sp--; break;
      case 0x04: D[sp] = D[sp - 1]; sp++; break;
      case 0x05: { const t = D[sp - 1]; D[sp - 1] = D[sp - 2]; D[sp - 2] = t; break; }
      case 0x06: D[sp] = D[sp - 2]; sp++; break;
      case 0x07: { const a = D[sp - 3]; D[sp - 3] = D[sp - 2]; D[sp - 2] = D[sp - 1]; D[sp - 1] = a; break; }
      case 0x17: D[sp - 1] = -D[sp - 1] | 0; break;
      case 0x1b: D[sp - 1] = ~D[sp - 1]; break;
      case 0x30: case 0x31: case 0x32: {
        const rel = ((p[pc - 2] | (p[pc - 1] << 8)) << 16) >> 16;
        let take = true;
        if (op !== 0x30) { const v = D[--sp]; take = op === 0x31 ? v === 0 : v !== 0; }
        if (take) pc = next + rel;
        break;
      }
      case 0x33:
        if (csp === CALLS_MAX) return { out: out.slice(0, olen), exit: 7 };
        C[csp++] = next; pc = p[pc - 2] | (p[pc - 1] << 8); break;
      case 0x34:
        if (csp === 0) return { out: out.slice(0, olen), exit: 8 };
        pc = C[--csp]; break;
      case 0x40: {
        const addr = D[sp - 1];
        if (addr < 0 || addr >= 256) return { out: out.slice(0, olen), exit: 6 };
        D[sp - 1] = M[addr]; break;
      }
      case 0x41: {
        const addr = D[sp - 1], v = D[sp - 2];
        if (addr < 0 || addr >= 256) return { out: out.slice(0, olen), exit: 6 };
        sp -= 2; M[addr] = v; break;
      }
      case 0x50: {
        const v = D[sp - 1];
        if (olen + decLen(v) > OUTPUT_MAX) return { out: out.slice(0, olen), exit: 11 };
        olen = writeDecimal(out, olen, v); sp--; break;
      }
      case 0x51:
        if (olen + 1 > OUTPUT_MAX) return { out: out.slice(0, olen), exit: 11 };
        out[olen++] = D[--sp] & 255; break;
      case 0x52: D[sp++] = inPos < inp.length ? inp[inPos++] : -1; break;
      case 0x53: return { out: out.slice(0, olen), exit: D[--sp] & 255 };
      default: { // Binary operators 0x10-0x16, 0x18-0x1e, 0x20-0x22.
        const b = D[sp - 1], a = D[sp - 2];
        let r;
        if (op === 0x10) r = (a + b) | 0;
        else if (op === 0x11) r = (a - b) | 0;
        else if (op === 0x12) r = Math.imul(a, b);
        else if (op === 0x13) { if (b === 0) return { out: out.slice(0, olen), exit: 4 }; r = a === -2147483648 && b === -1 ? a : (a / b) | 0; }
        else if (op === 0x14) { if (b === 0) return { out: out.slice(0, olen), exit: 4 }; r = b === -1 ? 0 : (a % b) | 0; }
        else if (op === 0x15) { if (b === 0) return { out: out.slice(0, olen), exit: 4 }; r = Math.floor((a >>> 0) / (b >>> 0)) | 0; }
        else if (op === 0x16) { if (b === 0) return { out: out.slice(0, olen), exit: 4 }; r = ((a >>> 0) % (b >>> 0)) | 0; }
        else if (op === 0x18) r = a & b;
        else if (op === 0x19) r = a | b;
        else if (op === 0x1a) r = a ^ b;
        else if (op === 0x1c) r = a << (b & 31);
        else if (op === 0x1d) r = a >> (b & 31);
        else if (op === 0x1e) r = (a >>> (b & 31)) | 0;
        else if (op === 0x20) r = a === b ? 1 : 0;
        else if (op === 0x21) r = a < b ? 1 : 0;
        else r = (a >>> 0) < (b >>> 0) ? 1 : 0;
        sp -= 2; D[sp++] = r; break;
      }
    }
  }
}

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
for (const id of readdirSync(I).sort()) {
  const r = run(new Uint8Array(readFileSync(join(I, id, 'program.bin'))), new Uint8Array(readFileSync(join(I, id, 'input.bin'))));
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'stdout.bin'), r.out);
  writeFileSync(join(O, id, 'exit.txt'), `${r.exit}\n`);
}
