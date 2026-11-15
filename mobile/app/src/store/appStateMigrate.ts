// AppState migration. v1 kept up to 30 recent application pages; v2 turns each into an application
// record (网申记录) with the same id, link and title, status 想投 and a company guessed from the title or host.
import { z } from 'zod';
import { guessCompany } from '../tracker/model/guessCompany';
import { AppStateSchema, defaultAppState, type AppState, type ApplicationRecord } from './appStateStore';

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/** Legacy (v1): a recent application page. */
export const RecentPageSchema = z.object({
  id: z.string().min(1).max(64),
  url: z.string().max(2048).refine(isHttpUrl),
  host: z.string().min(1).max(253),
  title: z.string().max(80).optional(),
  addedAt: z.number().int().nonnegative(),
});
export type RecentPage = z.infer<typeof RecentPageSchema>;

export const AppStateV1Schema = z.object({
  version: z.literal(1),
  onboardingDone: z.boolean().default(false),
  fillLanguage: z.enum(['active', 'zh', 'en']).default('active'),
  recentPages: z.array(RecentPageSchema).max(30).default([]),
});
export type AppStateV1 = z.infer<typeof AppStateV1Schema>;

/** The stored state comes from a newer app version: never overwrite it. */
export class AppStateTooNewError extends Error {
  constructor() {
    super('App state was written by a newer app version');
    this.name = 'AppStateTooNewError';
  }
}

const CURRENT_VERSION = 2;

function fromRecentPage(p: RecentPage): ApplicationRecord {
  return {
    id: p.id,
    url: p.url,
    host: p.host,
    ...(p.title !== undefined ? { title: p.title } : {}),
    company: guessCompany(p.title, p.host),
    companyGuessed: true,
    position: '',
    status: 'wish',
    statusAt: p.addedAt,
    remind: false,
    notes: '',
    createdAt: p.addedAt,
    openedAt: p.addedAt,
    updatedAt: p.addedAt,
    history: [],
  };
}

/** Any stored version → v2. Throws AppStateTooNewError for a newer version, a plain Error for anything corrupt. */
export function migrateAppState(raw: unknown): AppState {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('App state is not an object');
  const version = (raw as { version?: unknown }).version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) throw new Error('App state has no valid version');
  if (version > CURRENT_VERSION) throw new AppStateTooNewError();
  if (version === 1) {
    const v1 = AppStateV1Schema.parse(raw);
    return defaultAppState({
      onboardingDone: v1.onboardingDone,
      fillLanguage: v1.fillLanguage,
      applications: v1.recentPages.map(fromRecentPage),
    });
  }
  return AppStateSchema.parse(raw);
}
