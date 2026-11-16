// The host the address bar shows: ASCII / punycode form (so look-alike hosts are visible), no www.,
// the port when not default. Pure.
import { DEMO_ORIGIN } from './constants';

export interface DisplayHost {
  host: string;
  punycode: boolean;
  kind: 'secure' | 'insecure' | 'demo';
}

export function displayHost(url: string): DisplayHost {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { host: '', punycode: false, kind: 'insecure' };
  }
  // The WHATWG parser already gives the ASCII (punycode) form of an IDN and keeps IPv6 in brackets.
  let host = u.hostname.toLowerCase();
  const punycode = host.split('.').some((label) => label.startsWith('xn--'));
  if (host.startsWith('www.') && host.length > 4) host = host.slice(4);
  if (u.port) host = `${host}:${u.port}`;
  const kind = u.origin === DEMO_ORIGIN ? 'demo' : u.protocol === 'https:' ? 'secure' : 'insecure';
  return { host, punycode, kind };
}
