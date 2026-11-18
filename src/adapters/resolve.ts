// Picks the adapter for a page: by address, then by page marker, otherwise none and the general engine
// works alone. Runs per frame on that frame's own address.
import { querySelectorDeep } from '../engine/shadow';
import { ADAPTERS } from './index';
import type { AtsAdapter } from './types';

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const compiled = new Map<string, RegExp>();

function toRegExp(pattern: string): RegExp {
  let re = compiled.get(pattern);
  if (re) return re;
  const hostEnd = pattern.indexOf('/', pattern.indexOf('://') + 3);
  const host = hostEnd < 0 ? pattern : pattern.slice(0, hostEnd);
  const path = hostEnd < 0 ? '' : pattern.slice(hostEnd);
  const part = (text: string, star: string): string => text.split('*').map(escapeRegExp).join(star);
  // A star in the host stays in the host, so an address cannot borrow it by putting the name in its path.
  re = new RegExp(`^${part(host, '[^/?#]+')}${part(path, '.*')}$`, 'i');
  compiled.set(pattern, re);
  return re;
}

export function matchesUrl(pattern: string, href: string): boolean {
  return toRegExp(pattern).test(href);
}

function hasMarker(root: Document | ShadowRoot, selectors: readonly string[]): boolean {
  return selectors.some((s) => querySelectorDeep(root, s) !== null);
}

export function resolveAdapter(
  root: Document | ShadowRoot,
  adapters: readonly AtsAdapter[] = ADAPTERS,
  href: string = (root.nodeType === 9 ? (root as Document) : root.ownerDocument)?.location?.href ?? '',
): AtsAdapter | null {
  const byUrl = adapters.find((a) => a.match.urls.some((u) => matchesUrl(u, href)));
  if (byUrl) return byUrl;
  return adapters.find((a) => hasMarker(root, a.match.fingerprints ?? [])) ?? null;
}
