// Layered on-device AI coordinator: BM25 -> Chrome Built-in AI -> optional loopback Ollama with unidirectional fallback.
import type { Resume, Settings } from '../schema';
import { retrieveBm25Matches, retrieveSynonymFieldCandidates, type Bm25Match, type FieldKeyMatch } from './bm25';
import { generateWithChromeAi } from './chromeBuiltIn';
import { generateWithOllama } from './ollama';
import { wrapSafePrompt } from './promptGuard';

export type AiSourceKind = 'bm25' | 'chrome_ai' | 'ollama';

export interface AiDraftOutcome {
  text: string;
  source: AiSourceKind;
  matchedFrom?: string;
  fallbackUsed: boolean;
  injectionDetected: boolean;
  warning?: string;
}

export interface LocalFieldSuggestion {
  matches: Bm25Match[];
  fieldKeys: FieldKeyMatch[];
}

/** Fast, purely synchronous offline suggestion lookup for side panel / mobile report rows. */
export function computeLocalFieldSuggestion(label: string, resume: Resume): LocalFieldSuggestion {
  return {
    matches: retrieveBm25Matches(label, resume, 2),
    fieldKeys: retrieveSynonymFieldCandidates(label, resume.locale, 2),
  };
}

/**
 * Generate a reviewable form-field draft using the configured local AI stack:
 * Ollama (when explicitly enabled) -> Chrome Built-in AI -> Layer 1 BM25 fallback.
 * Never auto-fills the DOM.
 */
export async function generateReviewDraft(options: {
  questionLabel: string;
  sectionHint?: string | null;
  resume: Resume;
  settings?: Partial<Settings>;
  timeoutMs?: number;
}): Promise<AiDraftOutcome | null> {
  const { questionLabel, sectionHint, resume, settings, timeoutMs = 15_000 } = options;
  const safe = wrapSafePrompt(questionLabel, resume, sectionHint);
  const mode = settings?.aiLayerMode ?? 'auto_local';
  const ollamaEnabled = Boolean(settings?.ollamaEnabled) && mode === 'ollama';
  const bm25Top = retrieveBm25Matches(questionLabel, resume, 1)[0];

  if (mode !== 'bm25_only') {
    if (ollamaEnabled) {
      const ollamaRes = await generateWithOllama({
        endpoint: settings?.ollamaEndpoint,
        model: settings?.ollamaModel,
        system: safe.system,
        user: safe.user,
        timeoutMs,
      });
      if (ollamaRes.ok && ollamaRes.text) {
        return {
          text: ollamaRes.text,
          source: 'ollama',
          fallbackUsed: false,
          injectionDetected: safe.injectionDetected,
        };
      }
      // Fall through to Chrome Built-in AI then BM25 on failure/timeout.
      const chromeRes = await generateWithChromeAi(safe.system, safe.user, timeoutMs);
      if (chromeRes.available && chromeRes.text) {
        return {
          text: chromeRes.text,
          source: 'chrome_ai',
          fallbackUsed: true,
          injectionDetected: safe.injectionDetected,
          warning: ollamaRes.error,
        };
      }
      if (bm25Top) {
        return {
          text: bm25Top.text,
          source: 'bm25',
          matchedFrom: bm25Top.sourceLabel,
          fallbackUsed: true,
          injectionDetected: safe.injectionDetected,
          warning: ollamaRes.error,
        };
      }
      return null;
    }

    const chromeRes = await generateWithChromeAi(safe.system, safe.user, timeoutMs);
    if (chromeRes.available && chromeRes.text) {
      return {
        text: chromeRes.text,
        source: 'chrome_ai',
        fallbackUsed: false,
        injectionDetected: safe.injectionDetected,
      };
    }
  }

  if (bm25Top) {
    return {
      text: bm25Top.text,
      source: 'bm25',
      matchedFrom: bm25Top.sourceLabel,
      fallbackUsed: mode !== 'bm25_only',
      injectionDetected: safe.injectionDetected,
    };
  }
  return null;
}
