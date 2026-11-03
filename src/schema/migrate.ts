// Profile migrations. Table-driven: add `{ from: 1, run }` here when the schema moves to v2.
import { CURRENT_SCHEMA_VERSION, ProfileSchema, type Profile } from './resume';

export class ProfileMigrationError extends Error {
  override readonly name = 'ProfileMigrationError';
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

type Json = Record<string, unknown>;
interface Migration {
  /** Version this step upgrades from; it produces `from + 1`. */
  from: number;
  run(raw: Json): Json;
}

const isRecord = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

export const MIGRATIONS: readonly Migration[] = [
  {
    // v0: un-versioned `{ resumes }` → v1 (adds schemaVersion, defaults, active resume).
    from: 0,
    run(raw) {
      if (!Array.isArray(raw.resumes)) {
        throw new ProfileMigrationError('Un-versioned profile must contain a "resumes" array');
      }
      let activeResumeId: unknown = raw.activeResumeId;
      if (typeof activeResumeId !== 'string') {
        const first: unknown = raw.resumes[0];
        activeResumeId = isRecord(first) && typeof first.id === 'string' ? first.id : null;
      }
      return { ...raw, schemaVersion: 1, activeResumeId };
    },
  },
];

function readVersion(raw: Json): number {
  if (raw.schemaVersion === undefined) return 0;
  const v = raw.schemaVersion;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
    throw new ProfileMigrationError(`Invalid schemaVersion: ${JSON.stringify(v)}`);
  }
  return v;
}

/** Upgrade any stored profile to the current schema version and validate it. */
export function migrateProfile(raw: unknown): Profile {
  if (!isRecord(raw)) throw new ProfileMigrationError('Profile must be an object');
  let version = readVersion(raw);
  if (version > CURRENT_SCHEMA_VERSION) {
    throw new ProfileMigrationError(
      `Profile schemaVersion ${version} is newer than supported version ${CURRENT_SCHEMA_VERSION}`,
    );
  }
  let data: Json = raw;
  while (version < CURRENT_SCHEMA_VERSION) {
    const step = MIGRATIONS.find((m) => m.from === version);
    if (!step) throw new ProfileMigrationError(`No migration from schemaVersion ${version}`);
    data = step.run(data);
    version += 1;
  }
  const parsed = ProfileSchema.safeParse(data);
  if (!parsed.success) {
    throw new ProfileMigrationError(`Profile failed validation: ${parsed.error.message}`, { cause: parsed.error });
  }
  return parsed.data;
}
