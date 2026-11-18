import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearHybridEmbeddingCache,
  cosineSimilarity,
  encodeHashedNgramVector,
  fetchRedactedOllamaEmbedding,
  generateStarInterviewPrep,
  HYBRID_VECTOR_DIM,
  retrieveHybridMatches,
} from '../../../src/ai';
import { ResumeSchema } from '../../../src/schema';

afterEach(() => {
  clearHybridEmbeddingCache();
  vi.restoreAllMocks();
});

function sampleResume() {
  return ResumeSchema.parse({
    id: 'r1',
    title: 'Senior Frontend',
    locale: 'zh-CN',
    basics: { familyName: '张', givenName: '伟', idNumber: '110101199901011234' },
    contact: { email: 'secret@example.com', phone: '13800138000' },
    jobIntention: { positions: ['前端架构师'], cities: ['上海'] },
    work: [
      {
        company: '星辰科技',
        position: '高级前端工程师',
        startDate: '2022-03',
        endDate: '2024-08',
        current: false,
        description: '主导微前端架构升级；重构首屏构建流程，使 LCP 降低 42%，QPS 峰值提升 2.5 倍。',
      },
    ],
    projects: [
      {
        name: 'Zero-Copy 工作台',
        role: '核心研发',
        startDate: '2024-01',
        endDate: null,
        current: true,
        description: 'Built local-first IndexedDB storage engine and reduced cold-start latency by 35%.',
      },
    ],
    skills: [
      { name: 'TypeScript', level: 'Expert' },
      { name: 'Microfrontends', level: 'Proficient' },
    ],
    customAnswers: [
      {
        question: '为什么选择微前端架构重构方案？',
        answer: '通过微前端拆分解耦十余个业务子应用，将独立部署发布耗时缩短 60%。',
      },
    ],
  });
}

describe('ai/hybridRetriever', () => {
  it('encodes 512-dim unit-normalized hashed n-gram vectors deterministically', () => {
    const a = encodeHashedNgramVector('TypeScript Microfrontend Architecture');
    const b = encodeHashedNgramVector('typescript microfrontends architecture');
    const c = encodeHashedNgramVector('PostgreSQL Vacuum Checkpoint');

    expect(a.length).toBe(HYBRID_VECTOR_DIM);
    expect(cosineSimilarity(a, b)).toBeGreaterThan(0.55);
    expect(cosineSimilarity(a, c)).toBeLessThan(0.25);
  });

  it('fuses BM25 and hashed n-gram dense similarity with RRF (k=60)', async () => {
    const resume = sampleResume();
    const hits = await retrieveHybridMatches('microfrontends LCP optimization 架构重构', resume, { limit: 3 });

    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.semanticBackend).toBe('hashed-ngram');
    expect(hits[0]!.rrfScore).toBeGreaterThan(0);
    expect(hits.some((h) => h.id === 'work:0' || h.id === 'qa:0')).toBe(true);
  });

  it('rejects non-loopback Ollama embedding URLs and caches loopback responses', async () => {
    const remote = await fetchRedactedOllamaEmbedding('safe summary', { endpoint: 'https://evil.example.com' });
    expect(remote).toBeNull();

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embedding: [0.6, 0.8] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const v1 = await fetchRedactedOllamaEmbedding('redacted project overview', {
      endpoint: 'http://127.0.0.1:11434',
      model: 'nomic-embed-text',
    });
    const v2 = await fetchRedactedOllamaEmbedding('redacted project overview', {
      endpoint: 'http://127.0.0.1:11434',
      model: 'nomic-embed-text',
    });

    expect(v1).toEqual([0.6, 0.8]);
    expect(v2).toEqual([0.6, 0.8]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('ai/starPrep', () => {
  it('builds a factual deterministic STAR outline from resume experiences in bm25_only mode', async () => {
    const resume = sampleResume();
    const prep = await generateStarInterviewPrep({
      resume,
      targetRole: '前端架构师',
      entryKind: 'work',
      entryIndex: 0,
      settings: { aiLayerMode: 'bm25_only' },
    });

    expect(prep).not.toBeNull();
    expect(prep!.source).toBe('bm25');
    expect(prep!.factCheck.ok).toBe(true);
    expect(prep!.outline.situation).toContain('星辰科技');
    expect(prep!.outline.result).toContain('42%');
  });

  it('triggers Fact Guard rollback when Ollama invents ungrounded numbers in STAR draft', async () => {
    const resume = sampleResume();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        response: [
          'Situation: Led frontend platform at 星辰科技.',
          'Task: Improve cold startup speed across 999 microservices.',
          'Action: Rebuilt microfrontend bundler.',
          'Result: Improved conversion by 88% in 3 days.',
        ].join('\n'),
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const prep = await generateStarInterviewPrep({
      resume,
      entryKind: 'work',
      entryIndex: 0,
      settings: { aiLayerMode: 'ollama', ollamaEnabled: true, ollamaEndpoint: 'http://127.0.0.1:11434' },
    });

    expect(prep).not.toBeNull();
    expect(prep!.factCheck.ok).toBe(false);
    expect(prep!.factCheck.inventedMetrics).toEqual(expect.arrayContaining(['999', '88%']));
    expect(prep!.source).toBe('bm25');
    expect(prep!.fallbackUsed).toBe(true);
    expect(prep!.outline.result).not.toContain('88%');
  });
});
