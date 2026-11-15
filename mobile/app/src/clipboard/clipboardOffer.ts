// The copied-link offer on Home: look at the clip's label before touching its content, read each
// clip at most once, and never keep what was copied. The only things saved are the clip's timestamp and one-way
// digests of links the person waved away. Pure, apart from the digest (Web Crypto).
import { parseApplicationLinks } from '../home/pasteLink';
import { toFoundLink, type FoundLink } from '../incoming/route';
import type { ClipHint } from '../native/clipboardPeek';
import { DISMISSED_MAX, type AppState } from '../store/appStateStore';
import { recentKey } from '../store/recentPages';

export interface ClipOffer {
  stamp: number;
  links: FoundLink[];
}

type ClipSettings = AppState['clipboard'];

/** True only when every rule allows reading the clip's text. */
export function shouldRead(hint: ClipHint, s: ClipSettings, ctx: { active: boolean }): boolean {
  return (
    s.offer &&
    ctx.active &&
    hint.focused &&
    hint.hasText &&
    !hint.sensitive &&
    hint.likelyUrl !== 'no' &&
    hint.stamp !== null &&
    hint.stamp !== s.lastStamp
  );
}

/** SHA-256 of the link without its fragment, hex, first 32 characters. One way: the link cannot be read back. */
export async function linkDigest(url: string): Promise<string> {
  const bytes = new TextEncoder().encode(recentKey(url));
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(hash.slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The links of a copied text worth offering: not already a record (`known` holds recordKeys) and not waved away
 * before (`dismissed` holds digests; `digests` maps each link's recordKey to its digest). Null when none is left.
 */
export function pickOffer(
  text: string,
  stamp: number,
  known: ReadonlySet<string>,
  dismissed: ReadonlySet<string>,
  digests: ReadonlyMap<string, string>,
): ClipOffer | null {
  const links = parseApplicationLinks(text)
    .map(toFoundLink)
    .filter((link) => {
      const key = recentKey(link.url);
      const digest = digests.get(key);
      return !known.has(key) && digest !== undefined && !dismissed.has(digest);
    });
  return links.length > 0 ? { stamp, links } : null;
}

/** Puts digests first, newest first, without duplicates, keeping at most DISMISSED_MAX. */
export function rememberDismissed(s: ClipSettings, digests: readonly string[]): ClipSettings {
  const next: string[] = [];
  for (const d of [...digests, ...s.dismissed]) {
    if (!next.includes(d)) next.push(d);
    if (next.length === DISMISSED_MAX) break;
  }
  return { ...s, dismissed: next };
}
