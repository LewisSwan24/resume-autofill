// Conflict-aware resume + tracker + SHA-256 deduplicated attachment merge engine for `.raf` and WebRTC sync.
import { ATTACHMENT_SLOTS, pruneMissingAttachments, referencedFileIds } from '../editor';
import type { Profile, Resume, Settings } from '../schema';
import { mergeTrackerRecords, recordKey } from '../tracker';
import type { ApplicationRecord } from '../tracker/schema';
import { sha256Hex, type SkippedAttachmentMeta, type UnlockedAttachment, type UnlockedSyncPayload } from './raf';

export type ResumeDiffKind = 'add' | 'incoming_newer' | 'local_newer_or_same';

export interface ResumeMergeItem {
  resume: Resume;
  kind: ResumeDiffKind;
  localUpdatedAt?: number;
  incomingUpdatedAt: number;
  /** Default decision when merging: true means adopt incoming resume, false keeps local. */
  defaultUseIncoming: boolean;
}

export interface SyncMergePlan {
  resumes: ResumeMergeItem[];
  trackerTotalIncoming: number;
  trackerNewOrUpdated: number;
  attachmentCount: number;
}

export interface ExistingFileEntry {
  id: string;
  bytes: Uint8Array;
}

export interface SyncStorageAdapter {
  listExistingFiles(): Promise<ExistingFileEntry[]>;
  saveFile(input: { name: string; type: string; bytes: Uint8Array }): Promise<string>;
  deleteFile(id: string): Promise<void>;
}

/** Build a user-facing preview plan before applying an unlocked sync payload. */
export function planSyncMerge(
  existingProfile: Profile,
  incoming: UnlockedSyncPayload,
  existingTracker: readonly ApplicationRecord[],
): SyncMergePlan {
  const localById = new Map(existingProfile.resumes.map((r) => [r.id, r]));
  const resumes: ResumeMergeItem[] = incoming.profile.resumes.map((r) => {
    const local = localById.get(r.id);
    if (!local) {
      return {
        resume: r,
        kind: 'add',
        incomingUpdatedAt: r.updatedAt,
        defaultUseIncoming: true,
      };
    }
    if (r.updatedAt > local.updatedAt) {
      return {
        resume: r,
        kind: 'incoming_newer',
        localUpdatedAt: local.updatedAt,
        incomingUpdatedAt: r.updatedAt,
        defaultUseIncoming: true,
      };
    }
    return {
      resume: r,
      kind: 'local_newer_or_same',
      localUpdatedAt: local.updatedAt,
      incomingUpdatedAt: r.updatedAt,
      defaultUseIncoming: false,
    };
  });

  const existingByUrl = new Map(existingTracker.map((rec) => [recordKey(rec.url), rec]));
  let trackerNewOrUpdated = 0;
  for (const inc of incoming.tracker) {
    const prev = existingByUrl.get(recordKey(inc.url));
    if (!prev || inc.updatedAt > prev.updatedAt) trackerNewOrUpdated++;
  }

  return {
    resumes,
    trackerTotalIncoming: incoming.tracker.length,
    trackerNewOrUpdated,
    attachmentCount: incoming.attachments.length,
  };
}

export type SyncMergeErrorCode = 'missing_known_file';

export class SyncMergeError extends Error {
  readonly code: SyncMergeErrorCode;
  constructor(code: SyncMergeErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'SyncMergeError';
    this.code = code;
  }
}

async function restoreAttachmentsWithDedup(
  attachments: readonly UnlockedAttachment[],
  skipped: readonly SkippedAttachmentMeta[],
  storage: SyncStorageAdapter,
): Promise<{ idMap: Map<string, string>; knownIds: Set<string> }> {
  const existingFiles = await storage.listExistingFiles();
  const knownIds = new Set(existingFiles.map((f) => f.id));
  const hashToExistingId = new Map<string, string>();

  for (const existing of existingFiles) {
    const h = await sha256Hex(existing.bytes);
    if (!hashToExistingId.has(h)) hashToExistingId.set(h, existing.id);
  }

  // A delta left these files out because this device should already hold them: refuse before saving anything if it does not.
  const idMap = new Map<string, string>();
  for (const item of skipped) {
    const localId = hashToExistingId.get(item.hash);
    if (!localId) throw new SyncMergeError('missing_known_file', item.hash);
    for (const srcId of item.sourceIds) idMap.set(srcId, localId);
  }

  for (const item of attachments) {
    let targetId = hashToExistingId.get(item.hash);
    if (!targetId) {
      targetId = await storage.saveFile({ name: item.name, type: item.type, bytes: item.bytes });
      hashToExistingId.set(item.hash, targetId);
      knownIds.add(targetId);
    }
    for (const srcId of item.sourceIds) {
      idMap.set(srcId, targetId);
    }
  }

  return { idMap, knownIds };
}

/**
 * Point an incoming resume's slots at local file ids. An id that is neither in the archive nor known here
 * (light mode, or a file the sender lacked) keeps the local resume's existing slot value instead of being dropped.
 */
function remapResumeAttachments(
  resume: Resume,
  idMap: Map<string, string>,
  knownIds: Set<string>,
  local: Resume | undefined,
): Resume {
  const nextAttachments = { ...resume.attachments };
  let changed = false;
  for (const slot of ATTACHMENT_SLOTS) {
    const oldId = nextAttachments[slot];
    if (!oldId) continue;
    const mapped = idMap.get(oldId);
    if (mapped && mapped !== oldId) {
      nextAttachments[slot] = mapped;
      changed = true;
    } else if (!mapped && !knownIds.has(oldId)) {
      const keep = local?.attachments[slot];
      if (keep) nextAttachments[slot] = keep;
      else delete nextAttachments[slot];
      changed = true;
    }
  }
  return changed ? { ...resume, attachments: nextAttachments } : resume;
}

/** Repair linkedResumeId pointers so paired resumes remain valid and point only to existing ids. */
function normalizeLinks(resumes: Resume[]): Resume[] {
  const validIds = new Set(resumes.map((r) => r.id));
  return resumes.map((r) => {
    if (!r.linkedResumeId) return r;
    if (r.linkedResumeId === r.id || !validIds.has(r.linkedResumeId)) {
      const { linkedResumeId: _drop, ...rest } = r;
      return rest;
    }
    return r;
  });
}

export interface ApplyMergeOptions {
  strategy: 'merge' | 'replace';
  /** Ids of incoming resumes selected to overwrite local ones (or adopt when adding). Defaults to plan suggestions. */
  adoptIds?: ReadonlySet<string>;
  includeTracker?: boolean;
}

export interface AppliedSyncResult {
  profile: Profile;
  tracker: ApplicationRecord[];
  adoptedResumes: number;
  /**
   * Local files no longer referenced after a full import. Nothing is deleted here: delete them with
   * `deleteOrphanFiles` only after the returned profile and tracker are saved. Always empty for light imports.
   */
  orphanFileIds: string[];
}

/** Delete files listed by `applySyncMerge`; call only after the merged profile is safely stored. */
export async function deleteOrphanFiles(storage: Pick<SyncStorageAdapter, 'deleteFile'>, ids: readonly string[]): Promise<void> {
  for (const id of ids) await storage.deleteFile(id);
}

/**
 * Whether a fill writes identity numbers is one choice for every device: the one made last wins. A device that never
 * made it has no time on it, so any choice made elsewhere replaces its default.
 */
export function newerSensitiveChoice(local: Settings, incoming: Settings): Partial<Settings> {
  const at = incoming.sensitiveFieldsUpdatedAt;
  if (at === undefined || at <= (local.sensitiveFieldsUpdatedAt ?? -1)) return {};
  return { sensitiveFields: incoming.sensitiveFields, sensitiveFieldsUpdatedAt: at };
}

/** Execute merge or replace, deduplicate attachments by SHA-256, repair links, and list orphaned files (never deletes). */
export async function applySyncMerge(
  existingProfile: Profile,
  incoming: UnlockedSyncPayload,
  existingTracker: readonly ApplicationRecord[],
  storage: SyncStorageAdapter,
  options: ApplyMergeOptions,
): Promise<AppliedSyncResult> {
  const { idMap, knownIds } = await restoreAttachmentsWithDedup(incoming.attachments, incoming.skipped ?? [], storage);
  const localById = new Map(existingProfile.resumes.map((r) => [r.id, r]));
  const plan = planSyncMerge(existingProfile, incoming, existingTracker);
  const defaultAdopt = new Set(plan.resumes.filter((item) => item.defaultUseIncoming).map((item) => item.resume.id));
  const adoptIds = options.adoptIds ?? defaultAdopt;

  let mergedResumes: Resume[];
  let adoptedCount = 0;

  if (options.strategy === 'replace') {
    mergedResumes = incoming.profile.resumes.map((r) => remapResumeAttachments(r, idMap, knownIds, localById.get(r.id)));
    adoptedCount = mergedResumes.length;
  } else {
    const incomingById = new Map(incoming.profile.resumes.map((r) => [r.id, r]));
    const keptLocal = existingProfile.resumes.map((local) => {
      const inc = incomingById.get(local.id);
      if (inc && adoptIds.has(local.id)) {
        adoptedCount++;
        return remapResumeAttachments(inc, idMap, knownIds, local);
      }
      return local;
    });
    const existingIdSet = new Set(existingProfile.resumes.map((r) => r.id));
    const additions = incoming.profile.resumes
      .filter((r) => !existingIdSet.has(r.id) && adoptIds.has(r.id))
      .map((r) => {
        adoptedCount++;
        return remapResumeAttachments(r, idMap, knownIds, undefined);
      });
    mergedResumes = [...keptLocal, ...additions];
  }

  const repairedResumes = normalizeLinks(mergedResumes);
  const baseProfile: Profile =
    options.strategy === 'replace'
      ? {
          ...incoming.profile,
          resumes: repairedResumes,
          activeResumeId:
            incoming.profile.activeResumeId && repairedResumes.some((r) => r.id === incoming.profile.activeResumeId)
              ? incoming.profile.activeResumeId
              : (repairedResumes[0]?.id ?? null),
        }
      : {
          ...existingProfile,
          resumes: repairedResumes,
          settings: {
            ...existingProfile.settings,
            ...(existingProfile.settings.mappingPresetId || !incoming.profile.settings.mappingPresetId
              ? {}
              : { mappingPresetId: incoming.profile.settings.mappingPresetId }),
            ...newerSensitiveChoice(existingProfile.settings, incoming.profile.settings),
          },
          activeResumeId:
            existingProfile.activeResumeId && repairedResumes.some((r) => r.id === existingProfile.activeResumeId)
              ? existingProfile.activeResumeId
              : (repairedResumes[0]?.id ?? null),
        };

  const finalProfile = pruneMissingAttachments(baseProfile, knownIds);
  const keepRefs = referencedFileIds(finalProfile);

  // List files left unreferenced after a full replace/merge. Light means "no files sent", never "delete mine".
  const orphanFileIds = incoming.mode === 'light' ? [] : [...knownIds].filter((id) => !keepRefs.has(id));

  const finalTracker =
    options.includeTracker === false
      ? [...existingTracker]
      : options.strategy === 'replace'
        ? [...incoming.tracker]
        : mergeTrackerRecords(existingTracker, incoming.tracker);

  return {
    profile: finalProfile,
    tracker: finalTracker,
    adoptedResumes: adoptedCount,
    orphanFileIds,
  };
}
