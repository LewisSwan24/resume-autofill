// Layer 3: Loopback-only local Ollama adapter (extension pages only; never imported by background or content scripts).

export const DEFAULT_OLLAMA_ENDPOINT = 'http://127.0.0.1:11434';
export const DEFAULT_OLLAMA_MODEL = 'qwen2.5:3b';

const LOOPBACK_RE = /^http:\/\/(127\.0\.0\.1|localhost)(?::(\d{1,5}))?$/;

/** Strictly permit only local loopback `http://127.0.0.1[:port]` or `http://localhost[:port]` URLs. */
export function isValidLoopbackOllamaUrl(raw: string): boolean {
  const trimmed = raw.trim().replace(/\/+$/, '');
  const match = LOOPBACK_RE.exec(trimmed);
  if (!match) return false;
  if (match[2]) {
    const port = Number(match[2]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return false;
  }
  return true;
}

export function normalizeOllamaEndpoint(raw?: string): string {
  const candidate = (raw ?? '').trim().replace(/\/+$/, '') || DEFAULT_OLLAMA_ENDPOINT;
  if (!isValidLoopbackOllamaUrl(candidate)) {
    throw new Error('Ollama endpoint must be local loopback (http://127.0.0.1 or http://localhost)');
  }
  return candidate;
}

export interface OllamaDraftResult {
  ok: boolean;
  text?: string;
  error?: string;
}

/** Query installed local Ollama models from `/api/tags`. */
export async function listOllamaModels(
  endpoint?: string,
  timeoutMs = 5_000,
): Promise<{ ok: boolean; models: string[]; error?: string }> {
  let base: string;
  try {
    base = normalizeOllamaEndpoint(endpoint);
  } catch (err) {
    return { ok: false, models: [], error: err instanceof Error ? err.message : 'invalid_endpoint' };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/api/tags`, { method: 'GET', signal: ctrl.signal });
    if (!res.ok) return { ok: false, models: [], error: `HTTP ${res.status}` };
    const data = (await res.json()) as { models?: Array<{ name?: string }> };
    const models = (data.models ?? []).map((m) => m.name ?? '').filter(Boolean);
    return { ok: true, models };
  } catch (err) {
    return { ok: false, models: [], error: err instanceof Error ? err.message : 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

/** Draft a concise answer using a local Ollama `/api/generate` endpoint with strict loopback check & timeout. */
export async function generateWithOllama(options: {
  endpoint?: string;
  model?: string;
  system: string;
  user: string;
  timeoutMs?: number;
}): Promise<OllamaDraftResult> {
  let base: string;
  try {
    base = normalizeOllamaEndpoint(options.endpoint);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'invalid_endpoint' };
  }

  const model = (options.model ?? '').trim() || DEFAULT_OLLAMA_MODEL;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), options.timeoutMs ?? 15_000);

  try {
    const res = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        model,
        system: options.system,
        prompt: options.user,
        stream: false,
        options: { temperature: 0.2 },
      }),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const payload = (await res.json()) as { response?: string };
    const text = (payload.response ?? '').trim();
    return text ? { ok: true, text } : { ok: false, error: 'empty' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}
