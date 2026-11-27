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
  /** The file goes up in this request itself, with no storage post to wait for after it. */
  storesItself?: true;
  /** Only a body carrying a file in this multipart field is an upload; anything else sent there is not. */
  fileField?: string;
}

/** The file name of one file part in a multipart body. */
function fileName(body: string, field: string): string | null {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`name="${escaped}"; filename="([^"]*)"`).exec(body)?.[1] ?? null;
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
  {
    // Moka: `POST /api/outer/ats-candidate-extractor/resume/uploadAndParse/candidate`, the file as the multipart
    // field `resume`. Its answer, in Moka's { code, data, msg, success } wrapper, is the candidate read out of the
    // file; the page keeps `resumeKey` and `resumeName` (or `key` and `name`) as the stored resume, and copies
    // the rest into boxes that are still empty. The sample files are blank pages with nothing to read, so the
    // answer holds the stored resume and no fields.
    name: 'moka',
    matches: (method, url) => method === 'POST' && url.pathname === '/api/outer/ats-candidate-extractor/resume/uploadAndParse/candidate',
    reply: (request) =>
      ok({
        code: 0,
        codeType: 0,
        data: { resumeKey: 'replay/resume', resumeName: fileName(request.postData ?? '', 'resume') ?? 'resume.pdf' },
        msg: '成功',
        success: true,
      }),
    storesItself: true,
  },
  {
    // <company>.bamboohr.com: `POST /ajax/files/attachTemporary.php`, the file in multipart field `upload`. The page
    // keeps `fid` in its hidden resumeFileId, and takes the upload only when `status` is "OK".
    name: 'bamboohr',
    matches: (method, url) => method === 'POST' && url.hostname.endsWith('.bamboohr.com') && url.pathname === '/ajax/files/attachTemporary.php',
    reply: (request) => {
      const body = request.postData ?? '';
      return ok({
        status: 'OK',
        fid: 'replay-file-1',
        name: fileName(body, 'upload') ?? 'resume.pdf',
        type: /name="upload";[^\r\n]*\r?\nContent-Type: ([^\r\n]+)/.exec(body)?.[1] ?? 'application/octet-stream',
        size: body.length,
      });
    },
    storesItself: true,
  },
  {
    // jobs.jobvite.com: `POST /careers/resource/resume` (or `coverletter`), the file in multipart field `file`. The
    // page takes it when `msgInfo` is 200 and keeps `resourceInfo` as the attachment. A pasted resume goes to the
    // same address as a plain form: that one is the recording's.
    name: 'jobvite',
    matches: (method, url) => method === 'POST' && url.hostname === 'jobs.jobvite.com' && /^\/careers\/resource\/(?:resume|coverletter)$/.test(url.pathname),
    fileField: 'file',
    reply: (request) => {
      const name = fileName(request.postData ?? '', 'file') ?? 'resume.pdf';
      return ok({ msgInfo: 200, resourceInfo: { name, fileName: name, fileKind: 'Resume' } });
    },
    storesItself: true,
  },
];

/** Whether an upload request carries the file itself, so nothing is left to wait for once it is answered. */
export function storesItself(request: StubRequest): boolean {
  const url = new URL(request.url);
  return SERVICES.some((s) => s.storesItself === true && s.matches(request.method, url));
}

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
  if (!service) return null;
  if (service.fileField && fileName(request.postData ?? '', service.fileField) === null) return null;
  return service.reply(request, url);
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
/** A sample whose recording answers its uploads (`__uploads: "recorded"`): no stubs, a moment for the page to show the file. */
export async function uploadsFor(context: BrowserContext, expected: { __uploads?: 'recorded' }): Promise<UploadStubs> {
  if (expected.__uploads !== 'recorded') return answerUploads(context);
  return { settled: () => new Promise((resolve) => setTimeout(resolve, 1_000)) };
}

export async function answerUploads(context: BrowserContext): Promise<UploadStubs> {
  let handedOut = 0;
  let stored = 0;
  await context.route(/^https?:\/\//, async (route) => {
    const request = route.request();
    const reply = uploadReply({ method: request.method(), url: request.url(), postData: request.postData(), headers: request.headers() });
    if (!reply) return route.fallback();
    const stub = { method: request.method(), url: request.url() };
    if (new URL(request.url()).origin !== STORAGE_ORIGIN && !storesItself(stub)) handedOut++;
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
