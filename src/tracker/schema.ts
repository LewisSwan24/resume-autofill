// Shared application tracker schema (zod v4), aligned with mobile/app/src/store/appStateStore.ts.
import { z } from 'zod';

export const APPLICATIONS_MAX = 500;
export const UNTOUCHED_MAX = 30;
export const HISTORY_MAX = 20;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const YMD = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function isRealDate(value: string): boolean {
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export const APPLICATION_STATUSES = ['wish', 'filling', 'submitted', 'interview', 'closed'] as const;
export const ApplicationStatusSchema = z.enum(APPLICATION_STATUSES);

export const DeadlineSchema = z.object({
  date: z.string().regex(YMD).refine(isRealDate),
  time: z.string().regex(HHMM).optional(),
});

export const FillEntrySchema = z.object({
  at: z.number().int().nonnegative(),
  resumeId: z.string().min(1).max(64).optional(),
  locale: z.string().max(16).optional(),
  filled: z.number().int().min(0).max(10_000),
  attention: z.number().int().min(0).max(10_000),
  skipped: z.number().int().min(0).max(10_000),
  undone: z.boolean().default(false),
});

export const ApplicationRecordSchema = z.object({
  id: z.string().min(1).max(64),
  url: z.string().max(2048).refine(isHttpUrl),
  host: z.string().min(1).max(253),
  title: z.string().max(80).optional(),
  company: z.string().max(80).default(''),
  companyGuessed: z.boolean().default(true),
  position: z.string().max(80).default(''),
  status: ApplicationStatusSchema.default('wish'),
  statusAt: z.number().int().nonnegative(),
  deadline: DeadlineSchema.optional(),
  remind: z.boolean().default(false),
  notes: z.string().max(1000).default(''),
  createdAt: z.number().int().nonnegative(),
  openedAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  history: z.array(FillEntrySchema).max(HISTORY_MAX).default([]),
});

export type ApplicationStatus = z.infer<typeof ApplicationStatusSchema>;
export type Deadline = z.infer<typeof DeadlineSchema>;
export type FillEntry = z.infer<typeof FillEntrySchema>;
export type ApplicationRecord = z.infer<typeof ApplicationRecordSchema>;
