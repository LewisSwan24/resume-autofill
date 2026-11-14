// Which frames of a page count as the page's own site: a fill hands resume data only to those
// unless the person agrees to the others by name. Own site is deliberately narrow: the page host (www. and port
// ignored) and its subdomains, which the page host controls. A parent or a sibling host is another site, because
// without the full public-suffix list a shared parent (com.cn, github.io, a cloud bucket host) cannot be told apart
// from a company domain; the cost of that is one extra question, never data sent unasked. Pure.

function hostOf(origin: string): string | null {
  if (typeof origin !== 'string' || origin === 'null') return null;
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  return host || null;
}

const bare = (host: string) => (host.startsWith('www.') && host.length > 4 ? host.slice(4) : host);
const isIp = (host: string) => host.startsWith('[') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host);

/** The host to show the person: lower case, no www., no port; '' when the origin is not a web origin. */
export function siteHost(origin: string): string {
  const host = hostOf(origin);
  return host ? bare(host) : '';
}

/** True when `frameOrigin` is the page's own host or a subdomain of it. */
export function ownSite(pageOrigin: string, frameOrigin: string): boolean {
  const p = hostOf(pageOrigin);
  const f = hostOf(frameOrigin);
  if (!p || !f) return false;
  const page = bare(p);
  const frame = bare(f);
  if (page === frame) return true;
  if (isIp(page) || isIp(frame)) return false;
  return frame.endsWith(`.${page}`);
}
