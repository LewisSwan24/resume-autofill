// Extension-side application tracker persistence in `chrome.storage.local` + pure merge/filter helpers.
import { browser } from 'wxt/browser';
import { z } from 'zod';
import { guessCompany, cleanTitle } from './guessCompany';
import {
  APPLICATIONS_MAX,
  ApplicationRecordSchema,
  HISTORY_MAX,
  isHttpUrl,
  type ApplicationRecord,
  type ApplicationStatus,
  type Deadline,
  type FillEntry,
} from './schema';

export const TRACKER_STORAGE_KEY = 'extensionTracker';

const TrackerListSchema = z.array(ApplicationRecordSchema).max(APPLICATIONS_MAX);

export const recordKey = (url: string): string => {
  const hash = url.indexOf('#');
  return hash === -1 ? url : url.slice(0, hash);
};

function cut(value: string, max: number): string {
  if (value.length <= max) return value;
  let t = value.slice(0, max);
  const last = t.charCodeAt(t.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) t = t.slice(0, -1);
  return t;
}

const randomId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

let queue: Promise<unknown> = Promise.resolve();
function exclusive<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

export async function loadApplications(): Promise<ApplicationRecord[]> {
  const stored = await browser.storage.local.get(TRACKER_STORAGE_KEY);
  const parsed = TrackerListSchema.safeParse(stored[TRACKER_STORAGE_KEY]);
  return parsed.success ? parsed.data : [];
}

export function saveApplications(records: ApplicationRecord[]): Promise<ApplicationRecord[]> {
  return exclusive(async () => {
    const parsed = TrackerListSchema.parse(records.slice(0, APPLICATIONS_MAX));
    await browser.storage.local.set({ [TRACKER_STORAGE_KEY]: parsed });
    return parsed;
  });
}

export interface RecordFillInput {
  url: string;
  title?: string;
  filled: number;
  attention: number;
  skipped: number;
  resumeId?: string;
  variantId?: string;
  variantTitle?: string;
  locale?: string;
  now?: number;
}

/** Create or update an application record from a completed fill report. */
export function recordFillApplication(input: RecordFillInput): Promise<ApplicationRecord | null> {
  if (!isHttpUrl(input.url)) return Promise.resolve(null);
  return exclusive(async () => {
    const now = input.now ?? Date.now();
    const list = await loadApplications();
    const key = recordKey(input.url);
    const parsedUrl = new URL(input.url);
    const host = parsedUrl.host;
    const entry: FillEntry = {
      at: now,
      ...(input.resumeId ? { resumeId: input.resumeId } : {}),
      ...(input.variantId ? { variantId: input.variantId } : {}),
      ...(input.variantTitle ? { variantTitle: cut(input.variantTitle, 120) } : {}),
      ...(input.locale ? { locale: input.locale } : {}),
      filled: Math.max(0, Math.floor(input.filled)),
      attention: Math.max(0, Math.floor(input.attention)),
      skipped: Math.max(0, Math.floor(input.skipped)),
      undone: false,
    };

    const idx = list.findIndex((r) => recordKey(r.url) === key);
    let record: ApplicationRecord;
    if (idx >= 0) {
      const existing = list[idx]!;
      const title = input.title ? cleanTitle(input.title) || existing.title : existing.title;
      record = {
        ...existing,
        url: input.url,
        host,
        ...(title ? { title } : {}),
        ...(input.variantId ? { variantId: input.variantId } : {}),
        ...(input.variantTitle ? { variantTitle: cut(input.variantTitle, 120) } : {}),
        company: existing.companyGuessed ? guessCompany(title, host) : existing.company,
        status: existing.status === 'wish' ? 'filling' : existing.status,
        statusAt: existing.status === 'wish' ? now : existing.statusAt,
        openedAt: now,
        updatedAt: now,
        history: [entry, ...existing.history].slice(0, HISTORY_MAX),
      };
      const next = [record, ...list.filter((_, i) => i !== idx)].slice(0, APPLICATIONS_MAX);
      await browser.storage.local.set({ [TRACKER_STORAGE_KEY]: next });
      return record;
    }

    const title = input.title ? cleanTitle(input.title) || undefined : undefined;
    record = ApplicationRecordSchema.parse({
      id: randomId(),
      url: input.url,
      host,
      ...(title ? { title } : {}),
      ...(input.variantId ? { variantId: input.variantId } : {}),
      ...(input.variantTitle ? { variantTitle: cut(input.variantTitle, 120) } : {}),
      company: guessCompany(title, host),
      companyGuessed: true,
      position: '',
      status: 'filling',
      statusAt: now,
      remind: false,
      notes: '',
      createdAt: now,
      openedAt: now,
      updatedAt: now,
      history: [entry],
    });
    const next = [record, ...list].slice(0, APPLICATIONS_MAX);
    await browser.storage.local.set({ [TRACKER_STORAGE_KEY]: next });
    return record;
  });
}

export function addManualApplication(input: {
  url: string;
  company: string;
  position: string;
  deadline?: Deadline;
  now?: number;
}): Promise<ApplicationRecord | null> {
  if (!isHttpUrl(input.url)) return Promise.resolve(null);
  return exclusive(async () => {
    const now = input.now ?? Date.now();
    const list = await loadApplications();
    const key = recordKey(input.url);
    const existing = list.find((r) => recordKey(r.url) === key);
    if (existing) return existing;
    const host = new URL(input.url).host;
    const company = cut(input.company.trim(), 80);
    const record = ApplicationRecordSchema.parse({
      id: randomId(),
      url: input.url,
      host,
      company: company || guessCompany(undefined, host),
      companyGuessed: company === '',
      position: cut(input.position.trim(), 80),
      status: 'wish',
      statusAt: now,
      ...(input.deadline ? { deadline: input.deadline } : {}),
      remind: false,
      notes: '',
      createdAt: now,
      openedAt: now,
      updatedAt: now,
      history: [],
    });
    const next = [record, ...list].slice(0, APPLICATIONS_MAX);
    await browser.storage.local.set({ [TRACKER_STORAGE_KEY]: next });
    return record;
  });
}

export function updateApplication(
  id: string,
  patch: Partial<Pick<ApplicationRecord, 'company' | 'position' | 'notes' | 'status' | 'outcome' | 'deadline'>>,
  now = Date.now(),
): Promise<ApplicationRecord[]> {
  return exclusive(async () => {
    const list = await loadApplications();
    const next = list.map((r) => {
      if (r.id !== id) return r;
      const updated: ApplicationRecord = { ...r, updatedAt: now };
      if (patch.company !== undefined) {
        updated.company = cut(patch.company.trim(), 80);
        updated.companyGuessed = false;
      }
      if (patch.position !== undefined) updated.position = cut(patch.position.trim(), 80);
      if (patch.notes !== undefined) updated.notes = cut(patch.notes.trim(), 1000);
      if (patch.status !== undefined && patch.status !== r.status) {
        updated.status = patch.status;
        updated.statusAt = now;
      }
      if (patch.outcome !== undefined && patch.outcome !== r.outcome) {
        updated.outcome = patch.outcome;
      }
      if ('deadline' in patch) {
        if (patch.deadline) updated.deadline = patch.deadline;
        else delete updated.deadline;
      }
      return updated;
    });
    await browser.storage.local.set({ [TRACKER_STORAGE_KEY]: next });
    return next;
  });
}

export function deleteApplication(id: string): Promise<ApplicationRecord[]> {
  return exclusive(async () => {
    const next = (await loadApplications()).filter((r) => r.id !== id);
    await browser.storage.local.set({ [TRACKER_STORAGE_KEY]: next });
    return next;
  });
}

/** Merge two record arrays by URL key, keeping the newer `updatedAt` record and unioning fill history. */
export function mergeTrackerRecords(
  existing: readonly ApplicationRecord[],
  incoming: readonly ApplicationRecord[],
): ApplicationRecord[] {
  const byKey = new Map<string, ApplicationRecord>();
  for (const r of existing) byKey.set(recordKey(r.url), r);
  for (const r of incoming) {
    const k = recordKey(r.url);
    const prev = byKey.get(k);
    if (!prev || r.updatedAt > prev.updatedAt) {
      byKey.set(k, r);
    }
  }
  return [...byKey.values()]
    .sort((a, b) => b.openedAt - a.openedAt)
    .slice(0, APPLICATIONS_MAX);
}

export function filterApplications(
  records: readonly ApplicationRecord[],
  filter: 'all' | ApplicationStatus,
  query: string,
): ApplicationRecord[] {
  const terms = query.normalize('NFKC').toLowerCase().split(/\s+/).filter(Boolean);
  return records
    .filter((r) => {
      if (filter !== 'all' && r.status !== filter) return false;
      if (terms.length === 0) return true;
      const hay = [r.company, r.position, r.host, r.title ?? '', r.notes].map((s) => s.normalize('NFKC').toLowerCase());
      return terms.every((t) => hay.some((h) => h.includes(t)));
    })
    .sort((a, b) => b.openedAt - a.openedAt);
}
