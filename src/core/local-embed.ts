const DIM = 256;

function hashSeed(seed: number): (s: string) => number {
  let h = seed >>> 0;
  return (s: string) => {
    h = seed >>> 0;
    for (let i = 0; i < s.length; i++) {
      h = (h * 31 + s.charCodeAt(i)) >>> 0;
    }
    return h;
  };
}

const hashA = hashSeed(0x9e3779b1);
const hashB = hashSeed(0x85ebca6b);

function tokenize(text: string): string[] {
  const cleaned = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").trim();
  if (!cleaned) return [];
  const words = cleaned.split(/\s+/).filter((w) => w.length > 0);
  const tokens: string[] = [];
  for (const w of words) {
    tokens.push(w);
    if (w.length >= 4) {
      const padded = `^${w}$`;
      for (let i = 0; i <= padded.length - 3; i++) {
        tokens.push(padded.slice(i, i + 3));
      }
    }
  }
  return tokens;
}

export function localEmbed(text: string): number[] {
  const vec = new Array<number>(DIM).fill(0);
  const tokens = tokenize(text);
  if (tokens.length === 0) return vec;

  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
  const maxTf = Math.max(...tf.values());

  for (const [token, count] of tf) {
    const idx = hashA(token) % DIM;
    const sign = (hashB(token) & 1) === 0 ? 1 : -1;
    const weight = 0.5 + 0.5 * (count / maxTf);
    vec[idx] += sign * weight;
  }

  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < DIM; i++) vec[i] /= norm;
  }
  return vec;
}
