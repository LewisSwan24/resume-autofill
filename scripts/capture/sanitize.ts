// Sanitises what the capture tool records from a real page, and audits the result.
//
// Two outputs need different treatment:
// - The static snapshot loses everything that can run or fetch and all control state.
// - The HAR must keep working on replay, so scripts stay. Replacements are consistent (one secret, one
//   placeholder everywhere) so a URL built from a scrubbed body still matches the scrubbed entry.
//
// Regexes cannot recognise a person's name or address. On logged-in pages those come from an explicit
// term list. The audit walks the parsed structures rather than grepping the file, because a HAR is one line.
import { JSDOM } from 'jsdom';

// ---------------------------------------------------------------------------------------- text patterns

const SECRET_KEY =
  '(?:x[-_])?(?:csrf|xsrf)(?:[-_]?token)?|authenticity[-_]?token|access[-_]?token|refresh[-_]?token|id[-_]token|session[-_]?id|jsessionid|auth[-_]?token|api[-_]?key';

const JWT_RE = /eyJ[\w-]{6,}\.[\w-]{6,}\.[\w-]{6,}/g;
// `"csrfToken":"value"`. The value must be quoted, so code such as `csrfToken:e.token` is left alone.
const SECRET_QUOTED_RE = new RegExp(`((?<![\\w-])["']?(?:${SECRET_KEY})["']?\\s*[:=]\\s*["'])([^"'\\s]{8,})(["'])`, 'gi');
// `?access_token=value`. Only in a query string, so `var csrfToken=document.foo` is left alone.
const SECRET_QUERY_RE = new RegExp(`([?&](?:${SECRET_KEY})=)([^&#"'\\s;<>]{8,})`, 'gi');
const SECRET_COOKIE_RE = /((?:^|[\s;])jsessionid=)([^&#"'\s;<>]{8,})/gi;
const SECRET_ATTR_RE = new RegExp(
  `(name=["'](?:${SECRET_KEY}|_token)["'][^>]*?\\b(?:content|value)=["'])([^"']{8,})(["'])`,
  'gi',
);
const SECRET_ATTR_REV_RE = new RegExp(
  `(\\b(?:content|value)=["'])([^"']{8,})(["'][^>]*?name=["'](?:${SECRET_KEY}|_token)["'])`,
  'gi',
);

const EMAIL_RE = /[\w.+-]+(?:@|%40)[\w-]+(?:\.[\w-]+)*\.[a-zA-Z]{2,}/g;
const ASSET_SUFFIX = /\.(?:png|jpe?g|gif|svg|webp|avif|ico|css|js|mjs|map|woff2?|ttf|json|html?)$/i;
const EMAIL_PLACEHOLDER = /^redacted-\d+@example\.invalid$/i;

const PHONE_KEYED_RE =
  /(["']?[\w-]*(?:phone|mobile|cell|tel|手机|电话)[\w-]*["']?\s*[:=]\s*["'])([+\d][\d\s().-]{6,})(["'])/gi;
// The lookbehind also rejects / = ? & # so an id in a URL or query is not mistaken for a phone.
const PHONE_RES = [
  /(?<![\w.\-/=?&#])\+\d{1,3}[\s.-]?(?:\(?\d{1,5}\)?[\s.-]?){2,}\d/g, // international
  /(?<![\w.\-/=?&#])04\d{2}[\s.-]?\d{3}[\s.-]?\d{3}(?![\w-])/g, // AU mobile
  /(?<![\w.\-/=?&#])0[2378][\s.-]?\d{4}[\s.-]?\d{4}(?![\w-])/g, // AU landline
  /(?<![\w.\-/=?&#])1[3-9]\d[\s-]?\d{4}[\s-]?\d{4}(?![\w-])/g, // CN mobile
];
const SCRIPT_BLOCK = /(<script\b[\s\S]*?<\/script>)/gi;
// Subresource integrity vouches for the original bytes. Scrubbing changes them and the browser would refuse
// the script, so hashes are emptied in markup, manifests and bundles alike. This only touches the local sample.
const INTEGRITY_RE = /(["']?\bintegrity["']?\s*[:=]\s*["'])sha(?:256|384|512)-[\w+/=\s-]+(["'])/gi;
const isHtmlMime = (mime: string | undefined): boolean => /html/i.test(mime ?? '');
const PHONE_PLACEHOLDER = /^\+0{6}\d+$/;
const SECRET_PLACEHOLDER = /^REDACTED-/;
const TERM_PLACEHOLDER = 'REDACTED-TERM';

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function termRes(terms: string[] | undefined): RegExp[] {
  return [...(terms ?? [])]
    .map((t) => t.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map((t) => {
      // One letter would replace itself all over the page and break it.
      if (t.length < 2) throw new Error(`scrub term too short: "${t}"`);
      return new RegExp(escapeRe(t), 'gi');
    });
}

const isRealEmail = (m: string): boolean => !ASSET_SUFFIX.test(m) && !EMAIL_PLACEHOLDER.test(m.replace('%40', '@'));

export interface ScrubOptions {
  /** Literal strings that must not survive: the account holder's name, address, and so on. */
  terms?: string[] | undefined;
}

export interface TextOptions {
  /**
   * `keyed`: only values under a phone-like key. Safe for scripts and JSON, where bare digits are ids.
   * `all`: also anything shaped like a phone number. For human-visible text.
   */
  phones?: 'keyed' | 'all';
}

export class Scrubber {
  private readonly terms: RegExp[];
  private readonly map = new Map<string, string>();
  private counter = 0;

  constructor(opts: ScrubOptions = {}) {
    this.terms = termRes(opts.terms);
  }

  private placeholder(kind: 'secret' | 'email' | 'phone', value: string): string {
    const key = `${kind}:${value.toLowerCase().replace('%40', '@')}`;
    let out = this.map.get(key);
    if (!out) {
      const n = ++this.counter;
      out =
        kind === 'secret'
          ? `REDACTED-${n}`
          : kind === 'email'
            ? `redacted-${n}@example.invalid`
            : `+000000${String(n).padStart(4, '0')}`;
      this.map.set(key, out);
    }
    return out;
  }

  text(input: string, opts: TextOptions = {}): string {
    let s = input;
    for (const re of this.terms) s = s.replace(re, TERM_PLACEHOLDER);
    s = s.replace(JWT_RE, (m) => this.placeholder('secret', m));
    const secret = (m: string, pre: string, value: string, post = ''): string =>
      SECRET_PLACEHOLDER.test(value) ? m : `${pre}${this.placeholder('secret', value)}${post}`;
    s = s.replace(SECRET_QUOTED_RE, secret);
    s = s.replace(SECRET_ATTR_RE, secret);
    s = s.replace(SECRET_ATTR_REV_RE, secret);
    s = s.replace(SECRET_QUERY_RE, (m, pre: string, value: string) => secret(m, pre, value));
    s = s.replace(SECRET_COOKIE_RE, (m, pre: string, value: string) => secret(m, pre, value));
    s = s.replace(EMAIL_RE, (m) => (isRealEmail(m) ? this.placeholder('email', m) : m));
    s = s.replace(PHONE_KEYED_RE, (m, pre: string, value: string, post: string) =>
      PHONE_PLACEHOLDER.test(value) ? m : `${pre}${this.placeholder('phone', value)}${post}`,
    );
    if (opts.phones === 'all') {
      for (const re of PHONE_RES) {
        s = s.replace(re, (m) => (PHONE_PLACEHOLDER.test(m) ? m : this.placeholder('phone', m)));
      }
    }
    return s;
  }

  /**
   * An HTML response that must keep working on replay: visible text gets the full phone treatment,
   * script blocks only the keyed one, because bare digits there are usually ids. A phone sitting in JSON
   * or a script under an unrelated key can only be caught by the term list.
   */
  html(input: string): string {
    return input
      .split(SCRIPT_BLOCK)
      .map((part, i) => this.text(part, i % 2 === 1 ? {} : { phones: 'all' }))
      .join('');
  }

  body(input: string, mime: string | undefined): string {
    const scrubbed = isHtmlMime(mime) ? this.html(input) : this.text(input);
    return scrubbed.replace(INTEGRITY_RE, '$1$2');
  }
}

// ---------------------------------------------------------------------------------------- findings

export interface Finding {
  kind:
    | 'sensitive-header'
    | 'cookie-array'
    | 'email'
    | 'phone'
    | 'secret'
    | 'term'
    | 'unreadable'
    | 'script'
    | 'control-value';
  where: string;
  /** Masked: a report must not repeat what it found. */
  sample: string;
}

const mask = (s: string): string => (s.length <= 4 ? '****' : `${s.slice(0, 2)}…(${s.length})`);

function scanVisiblePhones(html: string, where: string): Finding[] {
  const out: Finding[] = [];
  html.split(SCRIPT_BLOCK).forEach((part, i) => {
    if (i % 2 === 1) return;
    for (const re of PHONE_RES) {
      for (const m of part.match(re) ?? []) {
        if (!PHONE_PLACEHOLDER.test(m)) out.push({ kind: 'phone', where, sample: mask(m) });
      }
    }
  });
  return out;
}

function scanText(text: string, where: string, terms: RegExp[]): Finding[] {
  const out: Finding[] = [];
  const add = (kind: Finding['kind'], value: string): void => {
    out.push({ kind, where, sample: mask(value) });
  };
  for (const m of text.match(EMAIL_RE) ?? []) if (isRealEmail(m)) add('email', m);
  for (const m of text.match(JWT_RE) ?? []) add('secret', m);
  for (const re of [SECRET_QUOTED_RE, SECRET_QUERY_RE, SECRET_COOKIE_RE, SECRET_ATTR_RE, SECRET_ATTR_REV_RE]) {
    for (const m of text.matchAll(re)) {
      if (!SECRET_PLACEHOLDER.test(m[2]!)) add('secret', m[2]!);
    }
  }
  for (const m of text.matchAll(PHONE_KEYED_RE)) {
    if (!PHONE_PLACEHOLDER.test(m[2]!)) add('phone', m[2]!);
  }
  for (const re of terms) {
    for (const m of text.match(re) ?? []) add('term', m);
  }
  return out;
}

// ---------------------------------------------------------------------------------------- static HTML

const KEEP_VALUE_TYPES = new Set(['radio', 'checkbox', 'submit', 'button', 'reset', 'image']);
const REMOVE_SELECTOR = 'script,noscript,link,base,object,embed,applet,meta[http-equiv]';
const VISIBLE_ATTRS = new Set(['href', 'title', 'alt', 'placeholder', 'aria-label', 'value', 'content']);

/** Every parent node in the tree, including the content of templates (declarative shadow roots). */
function allRoots(root: ParentNode): ParentNode[] {
  const out: ParentNode[] = [root];
  for (const t of root.querySelectorAll('template')) out.push(...allRoots(t.content));
  return out;
}

function cleanRoot(root: ParentNode, scrub: Scrubber, win: { NodeFilter: typeof NodeFilter; document: Document }): void {
  for (const el of root.querySelectorAll(REMOVE_SELECTOR)) el.remove();
  for (const el of root.querySelectorAll('meta[name]')) {
    if (/csrf|xsrf|token/i.test(el.getAttribute('name') ?? '')) el.remove();
  }

  for (const el of root.querySelectorAll('input')) {
    const type = (el.getAttribute('type') ?? 'text').toLowerCase();
    el.removeAttribute('checked');
    if (!KEEP_VALUE_TYPES.has(type)) el.removeAttribute('value');
  }
  for (const el of root.querySelectorAll('textarea')) el.textContent = '';
  for (const el of root.querySelectorAll('option')) el.removeAttribute('selected');

  // Comments and text. Templates are walked as their own roots.
  const walker = win.document.createTreeWalker(root as unknown as Node, win.NodeFilter.SHOW_TEXT | win.NodeFilter.SHOW_COMMENT);
  const comments: Node[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === 8) comments.push(n);
    else if (n.parentNode?.nodeName !== 'STYLE') n.nodeValue = scrub.text(n.nodeValue ?? '', { phones: 'all' });
  }
  for (const c of comments) c.parentNode?.removeChild(c);

  for (const el of root.querySelectorAll('*')) {
    for (const attr of [...el.attributes]) {
      if (/^on/i.test(attr.name) || attr.name === 'srcdoc') {
        el.removeAttribute(attr.name);
        continue;
      }
      const next = scrub.text(attr.value, VISIBLE_ATTRS.has(attr.name) ? { phones: 'all' } : {});
      if (next !== attr.value) el.setAttribute(attr.name, next);
    }
  }
}

export interface StaticOptions {
  /** Collected page CSS. Inlined so hidden things stay hidden when the snapshot loads offline. */
  css?: string | undefined;
}

export function sanitizeStaticHtml(html: string, scrub: Scrubber, opts: StaticOptions = {}): string {
  const dom = new JSDOM(html);
  const { document } = dom.window;
  const win = { NodeFilter: dom.window.NodeFilter as unknown as typeof NodeFilter, document: document as unknown as Document };
  for (const root of allRoots(document as unknown as ParentNode)) cleanRoot(root, scrub, win);
  if (opts.css) {
    const style = document.createElement('style');
    style.setAttribute('data-raf-inlined', '');
    style.textContent = scrub.text(opts.css);
    document.head.append(style);
  }
  return dom.serialize();
}

export function auditHtml(html: string, opts: ScrubOptions = {}): Finding[] {
  const out: Finding[] = [];
  const dom = new JSDOM(html);
  const roots = allRoots(dom.window.document as unknown as ParentNode);
  for (const root of roots) {
    for (const el of root.querySelectorAll(REMOVE_SELECTOR)) {
      out.push({ kind: 'script', where: 'html', sample: el.tagName.toLowerCase() });
    }
    for (const el of root.querySelectorAll('*')) {
      for (const attr of el.attributes) {
        if (/^on/i.test(attr.name) || attr.name === 'srcdoc') out.push({ kind: 'script', where: 'html', sample: attr.name });
      }
    }
    for (const el of root.querySelectorAll('input')) {
      const type = (el.getAttribute('type') ?? 'text').toLowerCase();
      if (!KEEP_VALUE_TYPES.has(type) && el.getAttribute('value')) {
        out.push({ kind: 'control-value', where: `input ${type}`, sample: mask(el.getAttribute('value')!) });
      }
      if (el.hasAttribute('checked')) out.push({ kind: 'control-value', where: `input ${type}`, sample: 'checked' });
    }
    for (const el of root.querySelectorAll('textarea')) {
      if (el.textContent) out.push({ kind: 'control-value', where: 'textarea', sample: mask(el.textContent) });
    }
    if (root.querySelector('option[selected]')) {
      out.push({ kind: 'control-value', where: 'option', sample: 'selected' });
    }
  }
  out.push(...scanText(html, 'html', termRes(opts.terms)));
  return out;
}

// ---------------------------------------------------------------------------------------- HAR

export interface HarPair {
  name: string;
  value: string;
}

export interface HarContent {
  mimeType?: string;
  text?: string;
  encoding?: string;
  _file?: string;
  size?: number;
}

export interface HarPostData {
  mimeType?: string;
  text?: string;
  params?: HarPair[];
  _file?: string;
}

export interface HarEntry {
  request: {
    method: string;
    url: string;
    headers: HarPair[];
    cookies: unknown[];
    queryString: HarPair[];
    postData?: HarPostData;
  };
  response: {
    status: number;
    headers: HarPair[];
    cookies: unknown[];
    content: HarContent;
    redirectURL?: string;
  };
}

export interface HarFile {
  log: {
    pages?: { title?: string }[];
    entries: HarEntry[];
  };
}

/** Sidecar body files written by Playwright's `updateContent: 'attach'`. */
export interface SidecarIo {
  read(name: string): string | null;
  write(name: string, text: string): void;
  remove(name: string): void;
}

const SENSITIVE_HEADER =
  /^(?:cookie2?|set-cookie2?|authorization|proxy-authorization|x-api-key|x-auth-token|x-amz-security-token|x-goog-api-key|.*(?:csrf|xsrf).*)$/i;
// The stored body is decoded and changes size.
const STALE_HEADER = /^(?:content-length|content-encoding)$/i;
const TEXT_MIME = /^text\/|json|javascript|xml|html|css|svg|x-www-form-urlencoded|graphql/i;

/** No declared type: treat as text unless it looks binary, so an unlabelled JSON body is still scrubbed. */
function isTextBody(mime: string | undefined, sample: string | null | undefined): boolean {
  if (mime) return TEXT_MIME.test(mime);
  return sample != null && !/[\0�]/.test(sample);
}

function scrubPairs(pairs: HarPair[] | undefined, scrub: Scrubber): HarPair[] {
  return (pairs ?? []).map((p) => ({ ...p, name: p.name, value: scrub.text(p.value) }));
}

/** Query values alone carry no key context, so scrub them in the shape they had in the URL. */
function scrubQuery(pairs: HarPair[] | undefined, scrub: Scrubber): HarPair[] {
  return (pairs ?? []).map((p) => {
    const line = scrub.text(`?${p.name}=${p.value}`);
    return { ...p, value: line.slice(line.indexOf('=') + 1) };
  });
}

function scrubSidecar(name: string, mime: string | undefined, scrub: Scrubber, io: SidecarIo): void {
  const text = io.read(name);
  if (text === null || !isTextBody(mime, text)) return;
  const next = scrub.body(text, mime);
  if (next !== text) io.write(name, next);
}

function scrubContent(c: HarContent, scrub: Scrubber, io: SidecarIo): void {
  if (c._file) {
    scrubSidecar(c._file, c.mimeType, scrub, io);
    return;
  }
  if (c.text === undefined || c.text === '') return;
  const base64 = c.encoding === 'base64';
  const decoded = base64 ? Buffer.from(c.text, 'base64').toString('utf8') : c.text;
  if (!isTextBody(c.mimeType, decoded)) return;
  c.text = scrub.body(decoded, c.mimeType);
  delete c.encoding;
  c.size = Buffer.byteLength(c.text);
}

/**
 * A prefetch is recorded with an empty body. Replayed, it answers the page's real request for the
 * same file with an empty script, and the page hangs with no error. Without the entry, the real
 * load is what replay finds, or the request is aborted where a test can see it.
 */
function dropEmptyPrefetches(har: HarFile, io: SidecarIo): void {
  const isEmptyPrefetch = ({ request, response }: HarEntry) =>
    !response.content.size && request.headers.some((h) => /^(sec-)?purpose$/i.test(h.name) && /prefetch/i.test(h.value));
  const dropped = har.log.entries.filter(isEmptyPrefetch);
  har.log.entries = har.log.entries.filter((e) => !isEmptyPrefetch(e));
  const inUse = new Set(har.log.entries.map((e) => e.response.content._file));
  for (const file of new Set(dropped.map((e) => e.response.content._file))) {
    if (file && !inUse.has(file)) io.remove(file);
  }
}

export function sanitizeHar(har: HarFile, scrub: Scrubber, io: SidecarIo): void {
  for (const page of har.log.pages ?? []) {
    if (page.title) page.title = scrub.text(page.title, { phones: 'all' });
  }
  // A sent body that cannot be read (compressed telemetry) cannot be vouched for, and replay does not need it.
  har.log.entries = har.log.entries.filter(({ request }) => {
    const file = request.postData?._file;
    if (!file || io.read(file) !== null) return true;
    io.remove(file);
    return false;
  });
  dropEmptyPrefetches(har, io);
  for (const { request, response } of har.log.entries) {
    request.url = scrub.text(request.url);
    request.headers = scrubPairs(request.headers.filter((h) => !SENSITIVE_HEADER.test(h.name)), scrub);
    request.cookies = [];
    request.queryString = scrubQuery(request.queryString, scrub);
    const post = request.postData;
    if (post) {
      if (post.text) post.text = scrub.text(post.text);
      if (post.params) post.params = scrubPairs(post.params, scrub);
      if (post._file) scrubSidecar(post._file, post.mimeType, scrub, io);
    }
    response.headers = scrubPairs(
      response.headers.filter((h) => !SENSITIVE_HEADER.test(h.name) && !STALE_HEADER.test(h.name)),
      scrub,
    );
    response.cookies = [];
    if (response.redirectURL) response.redirectURL = scrub.text(response.redirectURL);
    scrubContent(response.content, scrub, io);
  }
}

export function auditHar(har: HarFile, io: SidecarIo, opts: ScrubOptions = {}): Finding[] {
  const terms = termRes(opts.terms);
  const out: Finding[] = [];
  const scan = (text: string | undefined, where: string, mime?: string): void => {
    if (!text) return;
    out.push(...scanText(text, where, terms));
    if (isHtmlMime(mime)) out.push(...scanVisiblePhones(text, where));
  };
  const scanSidecar = (name: string, mime: string | undefined, where: string): void => {
    const text = io.read(name);
    if (text === null) {
      // A body that cannot be read cannot be vouched for, unless its type says it holds no text.
      if (!mime || TEXT_MIME.test(mime)) out.push({ kind: 'unreadable', where, sample: name });
      return;
    }
    if (isTextBody(mime, text)) scan(text, where, mime);
  };

  for (const page of har.log.pages ?? []) scan(page.title, 'page title');
  har.log.entries.forEach(({ request, response }, i) => {
    const where = `entry ${i}`;
    for (const h of [...request.headers, ...response.headers]) {
      if (SENSITIVE_HEADER.test(h.name)) out.push({ kind: 'sensitive-header', where, sample: h.name.toLowerCase() });
      else scan(h.value, `${where} header ${h.name}`);
    }
    if (request.cookies.length || response.cookies.length) {
      out.push({ kind: 'cookie-array', where, sample: String(request.cookies.length + response.cookies.length) });
    }
    scan(request.url, `${where} url`);
    for (const q of request.queryString ?? []) scan(`?${q.name}=${q.value}`, `${where} query`);
    const post = request.postData;
    if (post) {
      scan(post.text, `${where} post`);
      for (const p of post.params ?? []) scan(p.value, `${where} post param`);
      if (post._file) scanSidecar(post._file, post.mimeType, `${where} post sidecar`);
    }
    scan(response.redirectURL, `${where} redirect`);
    const c = response.content;
    if (c._file) {
      scanSidecar(c._file, c.mimeType, `${where} body sidecar`);
    } else if (c.text && isTextBody(c.mimeType, c.text)) {
      scan(c.encoding === 'base64' ? Buffer.from(c.text, 'base64').toString('utf8') : c.text, `${where} body`, c.mimeType);
    }
  });
  return out;
}
