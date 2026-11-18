// Dual-Path Hybrid RAG Retriever (BM25 + 512-dim hashed n-gram cosine / optional redacted Ollama embeddings) fused via RRF (k=60).
// Strictly extension-page only (never imported by background service worker or content scripts).
import { buildResumeCorpus, tokenize, type CorpusDoc } from './bm25';
import { normalizeOllamaEndpoint } from './ollama';
import { sanitizeUntrustedLabel } from './promptGuard';
import type { Resume } from '../schema';

export const HYBRID_VECTOR_DIM = 512;
export const HYBRID_RRF_K = 60;
const BM25_K1 = 1.5;
const BM25_B = 0.75;
const MIN_DENSE_COSINE = 0.08;
const EMBED_DB_NAME = 'raf-ai-embeddings-v1';
const EMBED_STORE_NAME = 'vectors';

const memoryEmbeddingCache = new Map<string, number[]>();

export interface HybridMatch {
  id: string;
  text: string;
  sourceLabel: string;
  sourceKind: CorpusDoc['sourceKind'];
  rrfScore: number;
  bm25Score: number;
  cosineSimilarity: number;
  bm25Rank: number | null;
  vectorRank: number | null;
  semanticBackend: 'hashed-ngram' | 'ollama-embeddings';
}

export interface HybridRetrieveOptions {
  limit?: number;
  bm25Weight?: number;
  semanticWeight?: number;
  useOllamaEmbeddings?: boolean;
  ollamaEndpoint?: string;
  ollamaEmbeddingModel?: string;
  timeoutMs?: number;
}

function fnv1a(input: string, seed = 0x811c9dc5): number {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function extractSubwordFeatures(text: string): string[] {
  const clean = text.toLowerCase().normalize('NFKC').trim();
  if (!clean) return [];
  const features: string[] = [...tokenize(clean)];

  // Alphanumeric 3-grams and 4-grams capture morphology / compound words (e.g. typescript/microfrontend).
  const latinWords = clean.match(/[a-z0-9]+/g) ?? [];
  for (const w of latinWords) {
    if (w.length <= 3) {
      features.push(`w:${w}`);
      continue;
    }
    const padded = `^${w}$`;
    for (let i = 0; i <= padded.length - 3; i++) features.push(`3:${padded.slice(i, i + 3)}`);
    for (let i = 0; i <= padded.length - 4; i++) features.push(`4:${padded.slice(i, i + 4)}`);
  }

  // Han 2-grams and 3-grams preserve semantic phrases without requiring a tokenizer dictionary.
  const hanSeq = clean.match(/\p{Script=Han}+/gu) ?? [];
  for (const seg of hanSeq) {
    for (let i = 0; i <= seg.length - 2; i++) features.push(`h2:${seg.slice(i, i + 2)}`);
    for (let i = 0; i <= seg.length - 3; i++) features.push(`h3:${seg.slice(i, i + 3)}`);
  }
  return features;
}

/** Deterministic offline signed feature-hashing vector (Weinberger 512-dim L2-normalized). */
export function encodeHashedNgramVector(text: string, dims = HYBRID_VECTOR_DIM): Float32Array {
  const vec = new Float32Array(dims);
  const features = extractSubwordFeatures(text);
  if (features.length === 0) return vec;

  for (const feat of features) {
    const idx = fnv1a(feat, 0x811c9dc5) % dims;
    const sign = (fnv1a(feat, 0x9e3779b9) & 1) === 0 ? 1 : -1;
    vec[idx] = (vec[idx] ?? 0) + sign;
  }

  let normSq = 0;
  for (let i = 0; i < dims; i++) {
    const v = vec[i] ?? 0;
    normSq += v * v;
  }
  if (normSq > 0) {
    const inv = 1 / Math.sqrt(normSq);
    for (let i = 0; i < dims; i++) vec[i] = (vec[i] ?? 0) * inv;
  }
  return vec;
}

export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

async function contentCacheKey(model: string, text: string): Promise<string> {
  const payload = `${model}\u0000${text}`;
  if (typeof crypto !== 'undefined' && crypto.subtle?.digest) {
    try {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    } catch {
      /* fallback to FNV pair */
    }
  }
  return `${fnv1a(payload, 0x811c9dc5)}-${fnv1a(payload, 0x9e3779b9)}`;
}

async function readIdbEmbedding(key: string): Promise<number[] | null> {
  const mem = memoryEmbeddingCache.get(key);
  if (mem) return mem;
  if (typeof indexedDB === 'undefined') return null;
  try {
    return await new Promise<number[] | null>((resolve) => {
      const req = indexedDB.open(EMBED_DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(EMBED_STORE_NAME)) {
          req.result.createObjectStore(EMBED_STORE_NAME);
        }
      };
      req.onerror = () => resolve(null);
      req.onsuccess = () => {
        try {
          const tx = req.result.transaction(EMBED_STORE_NAME, 'readonly');
          const getReq = tx.objectStore(EMBED_STORE_NAME).get(key);
          getReq.onsuccess = () => {
            const val = Array.isArray(getReq.result) ? (getReq.result as number[]) : null;
            if (val) memoryEmbeddingCache.set(key, val);
            req.result.close();
            resolve(val);
          };
          getReq.onerror = () => {
            req.result.close();
            resolve(null);
          };
        } catch {
          resolve(null);
        }
      };
    });
  } catch {
    return null;
  }
}

async function writeIdbEmbedding(key: string, vector: number[]): Promise<void> {
  memoryEmbeddingCache.set(key, vector);
  if (typeof indexedDB === 'undefined') return;
  try {
    await new Promise<void>((resolve) => {
      const req = indexedDB.open(EMBED_DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(EMBED_STORE_NAME)) {
          req.result.createObjectStore(EMBED_STORE_NAME);
        }
      };
      req.onerror = () => resolve();
      req.onsuccess = () => {
        try {
          const tx = req.result.transaction(EMBED_STORE_NAME, 'readwrite');
          tx.objectStore(EMBED_STORE_NAME).put(vector, key);
          tx.oncomplete = () => {
            req.result.close();
            resolve();
          };
          tx.onerror = () => {
            req.result.close();
            resolve();
          };
        } catch {
          resolve();
        }
      };
    });
  } catch {
    /* IndexedDB optional */
  }
}

/**
 * Fetch an embedding from loopback Ollama `/api/embeddings` with SHA-256 cache.
 * Only redacted corpus strings (no direct PII) should ever be passed here.
 */
export async function fetchRedactedOllamaEmbedding(
  redactedText: string,
  opts: { endpoint?: string; model?: string; timeoutMs?: number } = {},
): Promise<number[] | null> {
  let base: string;
  try {
    base = normalizeOllamaEndpoint(opts.endpoint);
  } catch {
    return null;
  }
  const clean = sanitizeUntrustedLabel(redactedText, 800);
  if (!clean) return null;
  const model = (opts.model ?? '').trim() || 'nomic-embed-text';
  const cacheKey = await contentCacheKey(model, clean);
  const cached = await readIdbEmbedding(cacheKey);
  if (cached) return cached;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 5_000);
  try {
    const res = await fetch(`${base}/api/embeddings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({ model, prompt: clean }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { embedding?: unknown };
    if (!Array.isArray(json.embedding) || json.embedding.length === 0) return null;
    const vector = json.embedding.filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
    if (vector.length === 0) return null;
    await writeIdbEmbedding(cacheKey, vector);
    return vector;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function scoreCorpusBm25(question: string, docs: CorpusDoc[]): number[] {
  const qTokens = tokenize(question);
  if (qTokens.length === 0 || docs.length === 0) return docs.map(() => 0);

  const tokenizedDocs = docs.map((d) => tokenize(`${d.queryText} ${d.answerText.slice(0, 160)}`));
  const avgDl = tokenizedDocs.reduce((sum, t) => sum + t.length, 0) / tokenizedDocs.length || 1;
  const df = new Map<string, number>();
  for (const tokens of tokenizedDocs) {
    for (const uniq of new Set(tokens)) df.set(uniq, (df.get(uniq) ?? 0) + 1);
  }

  const N = docs.length;
  return docs.map((doc, i) => {
    const tokens = tokenizedDocs[i]!;
    if (tokens.length === 0) return 0;
    const tf = new Map<string, number>();
    for (const tok of tokens) tf.set(tok, (tf.get(tok) ?? 0) + 1);

    let score = 0;
    for (const qt of qTokens) {
      const f = tf.get(qt) ?? 0;
      if (f === 0) continue;
      const nqi = df.get(qt) ?? 0;
      const idf = Math.log(1 + (N - nqi + 0.5) / (nqi + 0.5));
      const normTf = (f * (BM25_K1 + 1)) / (f + BM25_K1 * (1 - BM25_B + (BM25_B * tokens.length) / avgDl));
      score += idf * normTf;
    }
    return Math.round(score * doc.boost * 1000) / 1000;
  });
}

function toRanks(scores: number[], minThreshold: number): Array<number | null> {
  const indexed = scores
    .map((score, index) => ({ index, score }))
    .filter((x) => x.score > minThreshold)
    .sort((a, b) => b.score - a.score);
  const ranks: Array<number | null> = scores.map(() => null);
  indexed.forEach((item, rankIdx) => {
    ranks[item.index] = rankIdx + 1;
  });
  return ranks;
}

/**
 * Dual-Path Hybrid RAG Retriever over the user's resume corpus:
 * Path 1: Lexical BM25 over CJK bigrams + word tokens.
 * Path 2: Dense semantic cosine over offline 512-dim hashed 3/4-grams (or optional redacted loopback Ollama embeddings).
 * Fused via Reciprocal Rank Fusion (`k = 60`).
 */
export async function retrieveHybridMatches(
  question: string,
  resume: Resume,
  options: HybridRetrieveOptions = {},
): Promise<HybridMatch[]> {
  const cleanQ = sanitizeUntrustedLabel(question, 300);
  if (!cleanQ) return [];
  const docs = buildResumeCorpus(resume);
  if (docs.length === 0) return [];

  const limit = Math.max(1, options.limit ?? 3);
  const bm25Weight = options.bm25Weight ?? 1;
  const semanticWeight = options.semanticWeight ?? 1;

  const bm25Scores = scoreCorpusBm25(cleanQ, docs);
  const bm25Ranks = toRanks(bm25Scores, 0);

  let semanticBackend: HybridMatch['semanticBackend'] = 'hashed-ngram';
  let cosines: number[] | null = null;

  if (options.useOllamaEmbeddings) {
    const qEmb = await fetchRedactedOllamaEmbedding(cleanQ, {
      endpoint: options.ollamaEndpoint,
      model: options.ollamaEmbeddingModel,
      timeoutMs: options.timeoutMs,
    });
    if (qEmb) {
      const docEmbs = await Promise.all(
        docs.map((d) =>
          fetchRedactedOllamaEmbedding(`${d.queryText} ${d.answerText.slice(0, 260)}`, {
            endpoint: options.ollamaEndpoint,
            model: options.ollamaEmbeddingModel,
            timeoutMs: options.timeoutMs,
          }),
        ),
      );
      if (docEmbs.every((v): v is number[] => v !== null)) {
        cosines = docEmbs.map((v) => Math.round(cosineSimilarity(qEmb, v) * 1000) / 1000);
        semanticBackend = 'ollama-embeddings';
      }
    }
  }

  if (!cosines) {
    const qVec = encodeHashedNgramVector(cleanQ);
    cosines = docs.map((d) => {
      const dVec = encodeHashedNgramVector(`${d.queryText} ${d.answerText.slice(0, 260)}`);
      return Math.round(cosineSimilarity(qVec, dVec) * 1000) / 1000;
    });
  }

  const vectorRanks = toRanks(cosines, MIN_DENSE_COSINE);

  const fused: HybridMatch[] = [];
  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i]!;
    const bRank = bm25Ranks[i] ?? null;
    const vRank = vectorRanks[i] ?? null;
    if (bRank === null && vRank === null) continue;

    const rrfRaw =
      (bRank !== null ? bm25Weight / (HYBRID_RRF_K + bRank) : 0) +
      (vRank !== null ? semanticWeight / (HYBRID_RRF_K + vRank) : 0);
    const rrfScore = Math.round(rrfRaw * doc.boost * 10_000) / 10_000;

    fused.push({
      id: doc.id,
      text: doc.answerText,
      sourceLabel: doc.sourceLabel,
      sourceKind: doc.sourceKind,
      rrfScore,
      bm25Score: bm25Scores[i] ?? 0,
      cosineSimilarity: cosines[i] ?? 0,
      bm25Rank: bRank,
      vectorRank: vRank,
      semanticBackend,
    });
  }

  return fused.sort((a, b) => b.rrfScore - a.rrfScore).slice(0, limit);
}

/** Clear in-memory embedding cache (primarily for unit tests). */
export function clearHybridEmbeddingCache(): void {
  memoryEmbeddingCache.clear();
}
