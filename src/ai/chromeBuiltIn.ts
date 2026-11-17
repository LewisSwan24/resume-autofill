// Layer 2: Chrome Built-in AI (Prompt API `LanguageModel` / `ai.languageModel`) adapter with timeout & cleanup.

export interface BuiltInAiResult {
  available: boolean;
  text?: string;
  error?: string;
}

interface PromptSession {
  prompt(input: string, options?: { signal?: AbortSignal }): Promise<string>;
  destroy?: () => void;
}

interface LanguageModelApi {
  availability?: () => Promise<string>;
  capabilities?: () => Promise<{ available: string }>;
  create(options?: { systemPrompt?: string; initialPrompts?: Array<{ role: string; content: string }>; signal?: AbortSignal }): Promise<PromptSession>;
}

function locateLanguageModel(): LanguageModelApi | null {
  const g = globalThis as unknown as {
    LanguageModel?: LanguageModelApi;
    ai?: { languageModel?: LanguageModelApi };
  };
  return g.LanguageModel ?? g.ai?.languageModel ?? null;
}

/** Check whether Chrome Built-in AI LanguageModel is present and ready on this browser. */
export async function checkChromeAiAvailability(): Promise<'available' | 'downloadable' | 'unavailable'> {
  const api = locateLanguageModel();
  if (!api) return 'unavailable';
  try {
    if (typeof api.availability === 'function') {
      const state = await api.availability();
      if (state === 'readily' || state === 'available') return 'available';
      if (state === 'after-download' || state === 'downloadable') return 'downloadable';
      return 'unavailable';
    }
    if (typeof api.capabilities === 'function') {
      const cap = await api.capabilities();
      if (cap.available === 'readily') return 'available';
      if (cap.available === 'after-download') return 'downloadable';
    }
    return 'unavailable';
  } catch {
    return 'unavailable';
  }
}

/** Generate an open-ended form draft via Chrome Built-in AI, enforcing a strict timeout and session cleanup. */
export async function generateWithChromeAi(
  systemPrompt: string,
  userPrompt: string,
  timeoutMs = 15_000,
): Promise<BuiltInAiResult> {
  const api = locateLanguageModel();
  if (!api) return { available: false, error: 'unavailable' };

  const status = await checkChromeAiAvailability();
  if (status === 'unavailable') return { available: false, error: 'unavailable' };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let session: PromptSession | null = null;

  try {
    session = await api.create({
      systemPrompt,
      initialPrompts: [{ role: 'system', content: systemPrompt }],
      signal: ctrl.signal,
    });
    const raw = await session.prompt(userPrompt, { signal: ctrl.signal });
    const text = raw.trim();
    return text ? { available: true, text } : { available: true, error: 'empty' };
  } catch (err) {
    return { available: false, error: err instanceof Error ? err.message : 'failed' };
  } finally {
    clearTimeout(timer);
    try {
      session?.destroy?.();
    } catch {
      /* ignore session cleanup errors */
    }
  }
}
