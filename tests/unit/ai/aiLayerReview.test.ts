import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSampleProfile } from '../../../src/schema';
import {
  buildRedactedContext,
  fetchRedactedOllamaEmbedding,
  generateReviewDraft,
  generateStarInterviewPrep,
  isValidLoopbackOllamaUrl,
  normalizeOllamaEndpoint,
  resolveAiLayerMode,
  scrubFreeTextPii,
  wrapSafePrompt,
} from '../../../src/ai';

const enResume = () => structuredClone(createSampleProfile().resumes.find((r) => r.id === 'sample-en')!);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Legacy ollamaEnabled without aiLayerMode', () => {
  it('resolves to ollama mode the same way the settings panel does', () => {
    expect(resolveAiLayerMode({ ollamaEnabled: true })).toBe('ollama');
    expect(resolveAiLayerMode({})).toBe('auto_local');
    expect(resolveAiLayerMode(undefined)).toBe('auto_local');
    expect(resolveAiLayerMode({ aiLayerMode: 'bm25_only', ollamaEnabled: true })).toBe('bm25_only');
  });

  it('drafts through Ollama when only the legacy flag is set', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ response: 'Ollama legacy reply' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await generateReviewDraft({
      questionLabel: 'Why do you want this role?',
      resume: enResume(),
      settings: { ollamaEnabled: true },
    });
    expect(res?.source).toBe('ollama');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('Free-text PII scrub', () => {
  it('replaces emails, phone numbers and CN ID numbers but keeps years and percentages', () => {
    const text =
      'Reach me at jane.doe+jobs@example.com or 13800000000, AU 0400 000 000, +61 412 345 678, ' +
      'US +1 (415) 555-0100. ID 11010519491231002X. In 2024 I raised retention by 15% across 3 teams.';
    const out = scrubFreeTextPii(text);
    expect(out).not.toContain('example.com');
    expect(out).not.toContain('13800000000');
    expect(out).not.toContain('0400 000 000');
    expect(out).not.toContain('412 345 678');
    expect(out).not.toContain('555-0100');
    expect(out).not.toContain('11010519491231002X');
    expect(out).toContain('[email]');
    expect(out).toContain('[phone]');
    expect(out).toContain('[id]');
    expect(out).toContain('2024');
    expect(out).toContain('15%');
    expect(out).toContain('3 teams');
  });

  it('scrubs the self-introduction and custom answers in the redacted prompt context', () => {
    const resume = enResume();
    resume.selfIntroduction = 'Email me at me@example.org or call 13912345678.';
    resume.customAnswers = [{ question: 'Contact?', answer: 'Mobile 0400 111 222, ID 110105194912310021' }];
    const json = JSON.stringify(buildRedactedContext(resume));
    expect(json).not.toContain('me@example.org');
    expect(json).not.toContain('13912345678');
    expect(json).not.toContain('0400 111 222');
    expect(json).not.toContain('110105194912310021');
    expect(json).toContain('[email]');
  });

  it('scrubs text before it is sent for an Ollama embedding', async () => {
    const bodies: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        bodies.push(String(init?.body ?? ''));
        return new Response(JSON.stringify({ embedding: [0.1, 0.2] }), { status: 200 });
      }),
    );
    await fetchRedactedOllamaEmbedding('Profile summary, call 13800001111 or a@b.co', {
      endpoint: 'http://127.0.0.1:11434',
    });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).not.toContain('13800001111');
    expect(bodies[0]).not.toContain('a@b.co');
  });
});

describe('Trusted task kept outside the untrusted fence', () => {
  it('places the task before the fence, uncut, and fences only the page text', () => {
    const task = `Rewrite the summary using only resume facts. ${'Keep every claim grounded. '.repeat(20)}`.trim();
    const { user } = wrapSafePrompt('Senior Backend Engineer', enResume(), null, task);
    const fenceStart = user.indexOf('<untrusted_field>');
    expect(user).toContain(task);
    expect(user.indexOf(task)).toBeLessThan(fenceStart);
    const fenced = user.slice(fenceStart, user.indexOf('</untrusted_field>'));
    expect(fenced).toContain('Senior Backend Engineer');
    expect(fenced).not.toContain('Rewrite the summary');
  });

  it('sends the STAR instructions outside the fence', async () => {
    const prompts: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? '{}')) as { prompt?: string };
        if (body.prompt && String(_url).endsWith('/api/generate')) prompts.push(body.prompt);
        return new Response(JSON.stringify({ response: 'no outline' }), { status: 200 });
      }),
    );
    await generateStarInterviewPrep({
      resume: enResume(),
      entryKind: 'work',
      entryIndex: 0,
      settings: { aiLayerMode: 'ollama', ollamaEnabled: true },
    });
    expect(prompts).toHaveLength(1);
    const fenced = prompts[0]!.slice(prompts[0]!.indexOf('<untrusted_field>'));
    expect(fenced).not.toContain('STAR interview answer');
    expect(prompts[0]).toContain('Never invent numbers, percentages, employers, or dates.');
  });
});

describe('STAR prep deterministic path', () => {
  it('counts the target role as a fact and marks the template as a fallback when AI was wanted', async () => {
    vi.stubGlobal('LanguageModel', undefined);
    const res = await generateStarInterviewPrep({
      resume: enResume(),
      targetRole: 'Level 3 Software Engineer',
      entryKind: 'work',
      entryIndex: 0,
      settings: { aiLayerMode: 'auto_local' },
    });
    expect(res?.source).toBe('bm25');
    expect(res?.factCheck.ok).toBe(true);
    expect(res?.fallbackUsed).toBe(true);
  });
});

describe('Ollama endpoint limited to the CSP-allowed port 11434', () => {
  it('accepts only loopback on port 11434', () => {
    expect(isValidLoopbackOllamaUrl('http://127.0.0.1:11434')).toBe(true);
    expect(isValidLoopbackOllamaUrl('http://localhost:11434/')).toBe(true);
    expect(isValidLoopbackOllamaUrl('http://127.0.0.1:8080')).toBe(false);
    expect(isValidLoopbackOllamaUrl('http://localhost')).toBe(false);
    for (const bad of [
      'http://127.0.0.1@evil.com:11434',
      'http://127.0.0.1:11434@evil.com',
      'http://localhost.evil.com:11434',
      'http://[::1]:11434',
      'http://0.0.0.0:11434',
      'https://127.0.0.1:11434',
    ]) {
      expect(isValidLoopbackOllamaUrl(bad), bad).toBe(false);
    }
    expect(() => normalizeOllamaEndpoint('http://127.0.0.1:8080')).toThrow(/11434/);
  });

  it('pins the extension page CSP to the Ollama default port', () => {
    const config = readFileSync(path.resolve(__dirname, '../../../wxt.config.ts'), 'utf8');
    expect(config).toContain("connect-src 'self' http://127.0.0.1:11434 http://localhost:11434;");
    expect(config).not.toMatch(/https?:\/\/[^\s'"]+:\*/);
  });
});
