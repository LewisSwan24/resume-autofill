// The tracker inside the profile export. It rides as one extra top-level key after the profile's
// own keys; the desktop extension's parseProfileJson (a zod object that strips unknown keys) ignores it. Clipboard
// settings never travel: they describe this phone only.
import { z } from 'zod';
import {
  APPLICATIONS_MAX,
  ApplicationRecordSchema,
  ReminderSettingsSchema,
  type AppState,
  type ApplicationRecord,
  type ReminderSettings,
} from '../../store/appStateStore';

export const TRACKER_KEY = 'mobileTracker';
export const TRACKER_FORMAT = 'resume-autofill-mobile-tracker';

export interface TrackerExport {
  format: typeof TRACKER_FORMAT;
  version: 1;
  applications: ApplicationRecord[];
  reminders: ReminderSettings;
}

const TrackerExportSchema = z.object({
  format: z.literal(TRACKER_FORMAT),
  version: z.literal(1),
  applications: z.array(ApplicationRecordSchema).max(APPLICATIONS_MAX),
  reminders: ReminderSettingsSchema.prefault({}),
});

export type TrackerRead =
  | { kind: 'none' }
  | { kind: 'ok'; applications: ApplicationRecord[]; reminders: ReminderSettings }
  | { kind: 'invalid' };

/** The profile export with the tracker appended as its last key, pretty-printed like exportProfile. */
export function withTracker(profileJson: string, state: AppState): string {
  const tracker: TrackerExport = { format: TRACKER_FORMAT, version: 1, applications: state.applications, reminders: state.reminders };
  const profile = JSON.parse(profileJson) as Record<string, unknown>;
  const { [TRACKER_KEY]: _old, ...rest } = profile;
  return JSON.stringify({ ...rest, [TRACKER_KEY]: tracker }, null, 2);
}

/** The tracker part of a plain export. Never throws. */
export function readTracker(plainJson: string): TrackerRead {
  let raw: unknown;
  try {
    raw = JSON.parse(plainJson);
  } catch {
    return { kind: 'none' };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw) || !(TRACKER_KEY in raw)) return { kind: 'none' };
  const parsed = TrackerExportSchema.safeParse((raw as Record<string, unknown>)[TRACKER_KEY]);
  return parsed.success ? { kind: 'ok', applications: parsed.data.applications, reminders: parsed.data.reminders } : { kind: 'invalid' };
}
