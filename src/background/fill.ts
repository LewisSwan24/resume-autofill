// `fill:request` orchestration: ask every frame what it needs (`frame:needs`), send each frame only the
// resume subset and files that answer implies (`frame:fill` or `frame:preview`), merge the reports → store → notify.
import { browser } from 'wxt/browser';
import type { FileData } from '../drivers/types';
import { ATTACHMENT_PROP, isEmptyNeeds, parseFrameNeeds, type AttachmentKey, type FrameNeeds } from '../engine/fieldDeps';
import type { FillFilter, FillPreview, FillReport, FramePreview } from '../engine/types';
import { sendToFrame, type FillRequestResponse } from '../messaging';
import { materializeResume, type Resume, type SensitiveFieldMode, type SiteRecipe } from '../schema';
import { BUILTIN_SITE_RECIPES, matchRecipesForPage } from '../recipes';
import { isValidPresetId, type MappingPresetId } from '../templates/presets';
import { VaultLockedError, fileToFileData, getFile, loadProfile } from '../storage';
import { FRAME_TIMEOUT_MS, NEEDS_TIMEOUT_MS, collectFrameReports, collectFrames, listFrameIds } from './frames';
import { isFramePreview, mergeFramePreviews, mergeFrameReports } from './merge';
import { buildResumeSubset } from './subset';
import { clearPreview, loadPreview, savePreview, saveReport } from './tabState';
import { recordWizardStep, type WizardSessionState } from './wizardSession';

export interface PreviewApproval {
  excludedByFrame?: Record<number, string[]>;
  overridesByFrame?: Record<number, Record<string, string>>;
}

export interface FillDeps {
  /** Frame ids to ask, top frame first. Default: `webNavigation.getAllFrames`. */
  listFrameIds?: (tabId: number) => Promise<number[]>;
  /** Send `frame:needs` (no resume data). Default: `tabs.sendMessage(tabId, { type: 'frame:needs' }, { frameId })`. */
  sendNeeds?: (tabId: number, frameId: number) => Promise<unknown>;
  /** Send `frame:preview`. Default: `tabs.sendMessage(tabId, msg, { frameId })`. */
  sendPreview?: (tabId: number, frameId: number, payload: FramePayload) => Promise<unknown>;
  /** Send `frame:fill`. Default: `tabs.sendMessage(tabId, msg, { frameId })`. */
  sendFill?: (tabId: number, frameId: number, payload: FramePayload) => Promise<unknown>;
  /** Budget of `frame:fill` per frame. */
  timeoutMs?: number;
  /** Budget of `frame:needs` per frame. */
  needsTimeoutMs?: number;
  /** Bypass `previewBeforeFill` (set when committing a preview). */
  forceFill?: boolean;
  /** User exclusions / overrides from preview confirmation. */
  approval?: PreviewApproval;
  /**
   * Fill only while the tab is on this origin (auto-advance, where no one watches each step). Checked before any
   * frame is asked anything, and again before each frame gets resume data; a mismatch answers `origin_changed`.
   */
  expectOrigin?: string;
}

class OriginChangedError extends Error {}

async function tabOrigin(tabId: number): Promise<string | null> {
  const tab = await browser.tabs.get(tabId).catch(() => null);
  try {
    const o = typeof tab?.url === 'string' ? new URL(tab.url).origin : 'null';
    return o === 'null' ? null : o;
  } catch {
    return null;
  }
}

export interface FramePayload {
  runId: string;
  resume: Resume;
  files: Record<string, FileData>;
  filter?: FillFilter;
  presetId?: MappingPresetId;
  recipes?: SiteRecipe[];
  /** Sent only as 'fill': a frame told nothing reminds, which is the default. */
  sensitiveFields?: SensitiveFieldMode;
}

const defaultSendFill = (tabId: number, frameId: number, p: FramePayload): Promise<unknown> =>
  sendToFrame(tabId, frameId, { type: 'frame:fill', ...p });

const defaultSendPreview = (tabId: number, frameId: number, p: FramePayload): Promise<unknown> =>
  sendToFrame(tabId, frameId, {
    type: 'frame:preview',
    runId: p.runId,
    resume: p.resume,
    files: p.files,
    ...(p.presetId ? { presetId: p.presetId } : {}),
    ...(p.recipes ? { recipes: p.recipes } : {}),
    ...(p.sensitiveFields ? { sensitiveFields: p.sensitiveFields } : {}),
  });

const defaultSendNeeds = (tabId: number, frameId: number): Promise<unknown> =>
  sendToFrame(tabId, frameId, { type: 'frame:needs' });

const ALL_ATTACHMENT_KEYS = Object.keys(ATTACHMENT_PROP) as AttachmentKey[];

/** Ids of the files a resume references for the given attachment keys (default: all of them). */
export function attachmentIds(resume: Resume, keys: readonly AttachmentKey[] = ALL_ATTACHMENT_KEYS): string[] {
  return keys.map((k) => resume.attachments[ATTACHMENT_PROP[k]]).filter((id): id is string => !!id);
}

/**
 * Load the resume's attachments as driver-ready data, only for the given attachment keys (default: all).
 * Missing / unreadable files are left out.
 */
export async function loadAttachmentFiles(
  resume: Resume,
  keys: readonly AttachmentKey[] = ALL_ATTACHMENT_KEYS,
): Promise<Record<string, FileData>> {
  const files: Record<string, FileData> = {};
  for (const id of new Set(attachmentIds(resume, keys))) {
    try {
      const record = await getFile(id);
      if (record) files[id] = await fileToFileData(record);
    } catch {
      /* unreadable attachment: the field simply reports no_data */
    }
  }
  return files;
}

/** Metadata-only attachment entries for preview (no binary payload crosses IPC during preview). */
export async function loadAttachmentMeta(
  resume: Resume,
  keys: readonly AttachmentKey[] = ALL_ATTACHMENT_KEYS,
): Promise<Record<string, FileData>> {
  const files: Record<string, FileData> = {};
  for (const id of new Set(attachmentIds(resume, keys))) {
    try {
      const record = await getFile(id);
      if (record) files[id] = { name: record.name, type: record.type, dataUrl: '' };
    } catch {
      /* unreadable attachment */
    }
  }
  return files;
}

/** Deliver `report:updated` to the top frame (FAB) and to extension pages (side panel). */
export async function broadcastReport(tabId: number, report: FillReport): Promise<void> {
  const message = { type: 'report:updated', tabId, report } as const;
  await Promise.allSettled([
    browser.tabs.sendMessage(tabId, message, { frameId: 0 }),
    browser.runtime.sendMessage(message),
  ]);
}

/** Deliver `preview:updated` to the top frame (FAB) and extension pages (side panel). */
export async function broadcastPreview(tabId: number, preview: FillPreview | null): Promise<void> {
  const message = { type: 'preview:updated', tabId, preview } as const;
  await Promise.allSettled([
    browser.tabs.sendMessage(tabId, message, { frameId: 0 }),
    browser.runtime.sendMessage(message),
  ]);
}

export async function broadcastWizard(tabId: number, session: WizardSessionState | null): Promise<void> {
  const message = { type: 'wizard:updated', tabId, session } as const;
  await Promise.allSettled([
    browser.tabs.sendMessage(tabId, message, { frameId: 0 }),
    browser.runtime.sendMessage(message),
  ]);
}

/** Keep the service worker alive while a long fill runs (any extension API call resets the idle timer). */
export function keepAlive(): () => void {
  const timer = setInterval(() => {
    browser.storage.session.get('keepalive').catch(() => undefined);
  }, 20_000);
  return () => clearInterval(timer);
}

const inFlight = new Set<number>();

/** Test hook. */
export const isFillRunning = (tabId: number): boolean => inFlight.has(tabId);

function frameFilter(approval: PreviewApproval | undefined, frameId: number): FillFilter | undefined {
  if (!approval) return undefined;
  const excluded = approval.excludedByFrame?.[frameId];
  const overrides = approval.overridesByFrame?.[frameId];
  if (!excluded?.length && !overrides) return undefined;
  return {
    ...(excluded?.length ? { excludedFieldIds: excluded } : {}),
    ...(overrides ? { overrides } : {}),
  };
}

async function runPreviewInternal(
  tabId: number,
  resume: Resume,
  presetId: MappingPresetId | undefined,
  recipes: SiteRecipe[] | undefined,
  deps: FillDeps,
  sensitiveFields?: SensitiveFieldMode,
): Promise<FillRequestResponse> {
  const runId = crypto.randomUUID();
  const frameIds = await (deps.listFrameIds ?? listFrameIds)(tabId);
  const sendNeeds = deps.sendNeeds ?? defaultSendNeeds;
  const sendPreview = deps.sendPreview ?? defaultSendPreview;
  const parts = await collectFrames<FrameNeeds, FramePreview>(
    frameIds,
    async (frameId, needs) => {
      const payload: FramePayload = {
        runId,
        resume: buildResumeSubset(resume, needs, sensitiveFields ? { sensitiveFields } : {}),
        files: await loadAttachmentMeta(resume, needs.attachmentKeys),
        ...(presetId ? { presetId } : {}),
        ...(sensitiveFields ? { sensitiveFields } : {}),
        ...(recipes && recipes.length > 0 ? { recipes } : {}),
      };
      if (deps.expectOrigin !== undefined && (await tabOrigin(tabId)) !== deps.expectOrigin) throw new OriginChangedError();
      return sendPreview(tabId, frameId, payload);
    },
    isFramePreview,
    {
      timeoutMs: deps.timeoutMs ?? FRAME_TIMEOUT_MS,
      prepareTimeoutMs: deps.needsTimeoutMs ?? NEEDS_TIMEOUT_MS,
      prepare: async (frameId) => {
        const needs = parseFrameNeeds(await sendNeeds(tabId, frameId));
        if (!needs) throw new Error('Malformed frame needs');
        return isEmptyNeeds(needs) ? null : needs;
      },
    },
  );
  if (deps.expectOrigin !== undefined && (await tabOrigin(tabId)) !== deps.expectOrigin) return { ok: false, error: 'origin_changed' };
  if (parts.length === 0) return { ok: false, error: 'no_frames' };

  const preview = mergeFramePreviews(
    tabId,
    parts.map(({ frameId, result }) => ({ frameId, preview: result })),
  );
  await savePreview(tabId, preview);
  await broadcastPreview(tabId, preview);
  return { ok: true, preview: true };
}

/**
 * Fill one tab (or generate a dry-run preview when `settings.previewBeforeFill` is enabled).
 */
export async function runFillRequest(tabId: number, deps: FillDeps = {}): Promise<FillRequestResponse> {
  if (inFlight.has(tabId)) return { ok: false, error: 'busy' };
  inFlight.add(tabId);
  const stop = keepAlive();
  try {
    let profile;
    try {
      profile = await loadProfile();
    } catch (error) {
      if (error instanceof VaultLockedError) return { ok: false, error: 'vault_locked' };
      throw error;
    }
    const rawActive = profile.resumes.find((r) => r.id === profile.activeResumeId) ?? null;
    if (!rawActive) return { ok: false, error: 'no_resume' };
    const resume = materializeResume(rawActive, profile.resumes);

    const presetId = isValidPresetId(profile.settings.mappingPresetId) && profile.settings.mappingPresetId !== 'default'
      ? profile.settings.mappingPresetId
      : undefined;
    const sensitiveFields = profile.settings.sensitiveFields === 'fill' ? ('fill' as const) : undefined;

    const tabInfo = await browser.tabs.get(tabId).catch(() => null);
    const tabUrl = typeof tabInfo?.url === 'string' ? tabInfo.url : '';
    const expected = deps.expectOrigin;
    if (expected !== undefined && (await tabOrigin(tabId)) !== expected) return { ok: false, error: 'origin_changed' };
    /** Throws before a frame gets resume data if the tab has moved to another site meanwhile. */
    const stillOnSite = async () => {
      if (expected !== undefined && (await tabOrigin(tabId)) !== expected) throw new OriginChangedError();
    };
    const allRecipes = [...(profile.recipes ?? []), ...BUILTIN_SITE_RECIPES];
    const pageRecipes = tabUrl ? matchRecipesForPage(allRecipes, tabUrl) : undefined;

    if (profile.settings.previewBeforeFill && !deps.forceFill) {
      return await runPreviewInternal(tabId, resume, presetId, pageRecipes, deps, sensitiveFields);
    }

    const runId = crypto.randomUUID();
    const frameIds = await (deps.listFrameIds ?? listFrameIds)(tabId);
    const sendNeeds = deps.sendNeeds ?? defaultSendNeeds;
    const sendFill = deps.sendFill ?? defaultSendFill;
    const parts = await collectFrameReports<FrameNeeds>(
      frameIds,
      // Each frame gets the minimum it asked for: a resume subset and only the files its upload controls take.
      async (frameId, needs) => {
        await stillOnSite();
        const filter = frameFilter(deps.approval, frameId);
        const payload: FramePayload = {
          runId,
          resume: buildResumeSubset(resume, needs, sensitiveFields ? { sensitiveFields } : {}),
          files: await loadAttachmentFiles(resume, needs.attachmentKeys),
          ...(filter ? { filter } : {}),
          ...(presetId ? { presetId } : {}),
          ...(sensitiveFields ? { sensitiveFields } : {}),
          ...(pageRecipes && pageRecipes.length > 0 ? { recipes: pageRecipes } : {}),
        };
        return sendFill(tabId, frameId, payload);
      },
      {
        timeoutMs: deps.timeoutMs ?? FRAME_TIMEOUT_MS,
        prepareTimeoutMs: deps.needsTimeoutMs ?? NEEDS_TIMEOUT_MS,
        // Frames without a content script reject; frames with nothing recognisable get nothing at all.
        prepare: async (frameId) => {
          const needs = parseFrameNeeds(await sendNeeds(tabId, frameId));
          if (!needs) throw new Error('Malformed frame needs');
          return isEmptyNeeds(needs) ? null : needs;
        },
      },
    );
    if (expected !== undefined && (await tabOrigin(tabId)) !== expected) return { ok: false, error: 'origin_changed' };
    if (parts.length === 0) return { ok: false, error: 'no_frames' };

    const report = mergeFrameReports(parts);
    const hadPreview = deps.forceFill || (await loadPreview(tabId)) !== null;
    if (hadPreview) await clearPreview(tabId);
    await saveReport(tabId, report);
    const wizard = report.counts.filled > 0 ? await recordWizardStep(tabId, report.url || tabUrl, resume) : null;
    await Promise.allSettled([
      ...(hadPreview ? [broadcastPreview(tabId, null)] : []),
      ...(wizard ? [broadcastWizard(tabId, wizard)] : []),
      broadcastReport(tabId, report),
    ]);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    stop();
    inFlight.delete(tabId);
  }
}

export async function commitPreviewRequest(
  tabId: number,
  approval: PreviewApproval,
  deps: FillDeps = {},
): Promise<FillRequestResponse> {
  return runFillRequest(tabId, { ...deps, forceFill: true, approval });
}

export async function cancelPreviewRequest(tabId: number): Promise<void> {
  await clearPreview(tabId);
  await broadcastPreview(tabId, null);
}
