import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSampleProfile } from '../../../src/schema';
import { generateTailoredSummaryDraft } from '../../../src/tailor';

const enResume = () => structuredClone(createSampleProfile().resumes.find((r) => r.id === 'sample-en')!);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Tailored summary draft', () => {
  it('uses the deterministic summary, not a BM25 match, when no model answers', async () => {
    vi.stubGlobal('LanguageModel', undefined);
    const resume = enResume();
    resume.customAnswers = [
      { question: 'Target role keywords summary TypeScript', answer: 'TypeScript, SQL, Docker, Kubernetes' },
    ];
    const res = await generateTailoredSummaryDraft({
      resume,
      targetRole: 'Senior Backend Engineer',
      matchedKeywords: ['TypeScript'],
      settings: { aiLayerMode: 'auto_local' },
    });
    expect(res?.rewrittenText).not.toBe('TypeScript, SQL, Docker, Kubernetes');
    expect(res?.rewrittenText).toBe(`Target Role: Senior Backend Engineer. ${resume.selfIntroduction.trim()}`);
    expect(res?.source).toBe('bm25');
    expect(res?.fallbackUsed).toBe(true);
  });

  it('marks the deterministic summary as no fallback when the user chose BM25 only', async () => {
    const res = await generateTailoredSummaryDraft({
      resume: enResume(),
      targetRole: 'Senior Backend Engineer',
      matchedKeywords: [],
      settings: { aiLayerMode: 'bm25_only' },
    });
    expect(res?.source).toBe('bm25');
    expect(res?.fallbackUsed).toBe(false);
  });

  it('sends the rewrite instructions outside the untrusted fence and fences the JD role', async () => {
    const prompts: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        prompts.push((JSON.parse(String(init?.body ?? '{}')) as { prompt: string }).prompt);
        return new Response(JSON.stringify({ response: 'Graduate engineer focused on backend services.' }), { status: 200 });
      }),
    );
    const res = await generateTailoredSummaryDraft({
      resume: enResume(),
      targetRole: 'Senior Backend Engineer',
      matchedKeywords: ['TypeScript', 'SQL'],
      settings: { aiLayerMode: 'ollama', ollamaEnabled: true },
    });
    expect(res?.source).toBe('ollama');
    expect(prompts).toHaveLength(1);
    const prompt = prompts[0]!;
    const fenced = prompt.slice(prompt.indexOf('<untrusted_field>'), prompt.indexOf('</untrusted_field>'));
    expect(fenced).toContain('Senior Backend Engineer');
    expect(fenced).not.toContain('Do NOT invent');
    expect(prompt).toContain('Do NOT invent numbers, percentages, employers, or years.');
  });
});
