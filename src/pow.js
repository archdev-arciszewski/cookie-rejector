/* Proof-of-work dla zgłoszeń: szuka liczby `nonce`, dla której SHA-256(`${hashTreści}:${ts}:${nonce}`)
 * zaczyna się od `bits` zerowych bitów. Serwer sprawdza to jednym haszem, a masowe wysyłanie spamu staje się kosztowne.
 *
 * Własne SHA-256: pierwszy blok (64 znaki hasha treści) liczony raz, potem w pętli tylko drugi blok
 * — kilkadziesiąt razy szybciej niż wołanie crypto.subtle.digest w pętli. */
(function (g) {
  'use strict';

  const K = Int32Array.from([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]);
  const IV = Int32Array.from([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const W = new Int32Array(64);

  /** Jeden blok SHA-256: stan `h` + 64 bajty z `bytes` → wynik do `out`. */
  function compress(h, bytes, out) {
    for (let i = 0; i < 16; i++) {
      const o = 4 * i;
      W[i] = (bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3];
    }
    for (let i = 16; i < 64; i++) {
      const a = W[i - 15], b = W[i - 2];
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
    }
    let A = h[0], B = h[1], C = h[2], D = h[3], E = h[4], F = h[5], G = h[6], H = h[7];
    for (let i = 0; i < 64; i++) {
      const S1 = ((E >>> 6) | (E << 26)) ^ ((E >>> 11) | (E << 21)) ^ ((E >>> 25) | (E << 7));
      const t1 = (H + S1 + ((E & F) ^ (~E & G)) + K[i] + W[i]) | 0;
      const S0 = ((A >>> 2) | (A << 30)) ^ ((A >>> 13) | (A << 19)) ^ ((A >>> 22) | (A << 10));
      const t2 = (S0 + ((A & B) ^ (A & C) ^ (B & C))) | 0;
      H = G; G = F; F = E; E = (D + t1) | 0; D = C; C = B; B = A; A = (t1 + t2) | 0;
    }
    out[0] = (h[0] + A) | 0; out[1] = (h[1] + B) | 0; out[2] = (h[2] + C) | 0; out[3] = (h[3] + D) | 0;
    out[4] = (h[4] + E) | 0; out[5] = (h[5] + F) | 0; out[6] = (h[6] + G) | 0; out[7] = (h[7] + H) | 0;
  }

  function leadingZeroBits(words) {
    let n = 0;
    for (const w of words) {
      if (w === 0) { n += 32; continue; }
      return n + Math.clz32(w);
    }
    return n;
  }

  /** bodyHash: 64 znaki hex (SHA-256 treści). Zwraca nonce (liczbę). */
  function solve(bodyHash, ts, bits) {
    if (!/^[0-9a-f]{64}$/.test(bodyHash)) throw new Error('bodyHash');
    const ascii = s => Uint8Array.from(s, c => c.charCodeAt(0));
    const mid = new Int32Array(8);
    compress(IV, ascii(bodyHash), mid);
    const prefix = ascii(`:${ts}:`);
    const block = new Uint8Array(64);
    const out = new Int32Array(8);
    const digits = new Uint8Array(16);
    for (let n = 0; n < 2 ** 40; n++) {
      // cyfry n (ASCII)
      let len = 0, x = n;
      do { digits[len++] = 48 + (x % 10); x = Math.floor(x / 10); } while (x > 0);
      block.fill(0);
      block.set(prefix, 0);
      for (let i = 0; i < len; i++) block[prefix.length + i] = digits[len - 1 - i];
      const tail = prefix.length + len;
      block[tail] = 0x80;
      const bitLen = (64 + tail) * 8;
      block[62] = bitLen >>> 8; block[63] = bitLen & 0xff;
      compress(mid, block, out);
      if (leadingZeroBits(out) >= bits) return n;
    }
    throw new Error('pow');
  }

  g.CCR_POW = { solve };
})(globalThis);
