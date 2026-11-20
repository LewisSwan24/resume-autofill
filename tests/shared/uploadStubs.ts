// Upload services for a replay. A recording holds no upload, so when a page sends the file it was given, its
// request gets no answer and the page clears its box: the score would show what the recording lacks, not
// what the fill did. Each stub answers in that site's own protocol, read from its scripts, and the storage
// stub takes the file the way S3 does. Nothing here reaches a real host.
import type { BrowserContext } from '@playwright/test';

/** Where every stubbed storage form posts to. `.invalid` never resolves, so a miss here cannot leave. */
export const STORAGE_ORIGIN = 'https://replay-storage.invalid';

export interface StubRequest {
  method: string;
  url: string;
  postData?: string | null;
  headers?: Record<string, string>;
}

export interface StubReply {
  status: number;
  headers: Record<string, string>;
  body: string;
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PUT, OPTIONS',
  'access-control-allow-headers': '*',
  'access-control-expose-headers': 'Location, ETag',
};

const ok = (body: unknown): StubReply => ({
  status: 200,
  headers: { 'content-type': 'application/json; charset=utf-8', ...CORS },
  body: JSON.stringify(body),
});

/** An S3 POST policy form: the page posts these fields, then the file, to `url`. */
const storageForm = (site: string, key: string) => ({
  url: `${STORAGE_ORIGIN}/${site}/`,
  fields: { key, policy: 'replay-policy', 'x-amz-signature': 'replay-signature' },
});

const storedAt = (site: string, key: string): string => `${STORAGE_ORIGIN}/${site}/${encodeURIComponent(key)}`;

interface Service {
  name: string;
  matches(method: string, url: URL): boolean;
  reply(request: StubRequest, url: URL): StubReply;
}

const SERVICES: Service[] = [
  {
    // apply.workable.com: `GET /api/v1/jobs/<job>/form/upload/<field>` → { uploadPostUrl: {url, fields}, downloadUrl }.
    name: 'workable',
    matches: (method, url) => method === 'GET' && /^\/api\/v1\/jobs\/[^/]+\/form\/upload\/[^/]+$/.test(url.pathname),
    reply: (_request, url) => {
      const field = url.pathname.split('/').pop()!;
      const key = `uploads/${field}/replay-file`;
      return ok({ uploadPostUrl: storageForm('workable', key), downloadUrl: storedAt('workable', key) });
    },
  },
  {
    // ats.rippling.com: `GET /api/v1/utility/file_upload_url` → { data: { url, fields, finalUrl: { url } } }.
    name: 'rippling',
    matches: (method, url) => method === 'GET' && url.pathname === '/api/v1/utility/file_upload_url',
    reply: () => {
      const key = 'uploads/replay-file';
      return ok({ data: { ...storageForm('rippling', key), acl: false, finalUrl: { url: storedAt('rippling', key) } } });
    },
  },
  {
    // *.teamtailor.com: `POST /uploads/presigned_data` → { url, fields }; the page puts the file's name into `${filename}`.
    name: 'teamtailor',
    matches: (method, url) => method === 'POST' && url.pathname === '/uploads/presigned_data',
    reply: () => ok(storageForm('teamtailor', 'uploads/replay/${filename}')),
  },
];

/** The value of one text field in a multipart body. */
function formField(body: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`name="${escaped}"\\r\\n\\r\\n([^\\r]*)\\r\\n`).exec(body);
  return m ? m[1]! : null;
}

function storageReply(request: StubRequest, url: URL): StubReply {
  if (request.method === 'OPTIONS') return { status: 204, headers: { ...CORS }, body: '' };
  const site = url.pathname.split('/')[1] ?? '';
  const key = formField(request.postData ?? '', 'key') ?? 'replay-file';
  // S3's answer to a POST policy upload with no success_action_status: 204, the stored object at Location.
  return { status: 204, headers: { ...CORS, location: storedAt(site, key), etag: '"replay"' }, body: '' };
}

/** The stub's answer to a request, or null when it is the recording's to answer. */
export function uploadReply(request: StubRequest): StubReply | null {
  const url = new URL(request.url);
  if (url.origin === STORAGE_ORIGIN) return storageReply(request, url);
  const service = SERVICES.find((s) => s.matches(request.method, url));
  return service ? service.reply(request, url) : null;
}

export interface UploadStubs {
  /**
   * Resolves once every storage form handed out has had its file posted, and the page has had a moment to show
   * it. A fill ends when the page took the file; the page sends it on its own time after that.
   */
  settled(): Promise<void>;
}

const SETTLE_MS = 5_000;
const SHOW_MS = 300;

/** Register after `routeFromHAR`: a later route is asked first, and anything not an upload falls back to the recording. */
export async function answerUploads(context: BrowserContext): Promise<UploadStubs> {
  let handedOut = 0;
  let stored = 0;
  await context.route(/^https?:\/\//, async (route) => {
    const request = route.request();
    const reply = uploadReply({ method: request.method(), url: request.url(), postData: request.postData(), headers: request.headers() });
    if (!reply) return route.fallback();
    if (new URL(request.url()).origin !== STORAGE_ORIGIN) handedOut++;
    else if (request.method() === 'POST') stored++;
    return route.fulfill(reply);
  });
  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  return {
    async settled() {
      for (const end = Date.now() + SETTLE_MS; stored < handedOut && Date.now() < end; ) await pause(50);
      await pause(SHOW_MS);
    },
  };
}
