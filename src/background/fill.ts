// `fill:request` orchestration: ask every frame what it needs (`frame:needs`), send each frame only the\n// resume subset and files that answer implies (`frame:fill`), merge the reports → store → notify.
import { browser } from 'wxt/browser';
import type { FileData } from '../drivers/types';
import { ATTACHMENT_PROP, isEmptyNeeds, parseFrameNeeds, type AttachmentKey, type FrameNeeds } from '../engine/fieldDeps';
import type { FillReport } from '../engine/types';
import { sendToFrame, type FillRequestResponse } from '../messaging';
import type { Resume } from '../schema';
import { fileToFileData, getActiveResume, getFile } from '../storage';
import { FRAME_TIMEOUT_MS, NEEDS_TIMEOUT_MS, collectFrameReports, listFrameIds } from './frames';
import { mergeFrameReports } from './merge';
import { buildResumeSubset } from './subset';
import { saveReport } from './tabState';

export interface FillDeps {
  /** Frame ids to ask, top frame first. Default: `webNavigation.getAllFrames`. */
  listFrameIds?: (tabId: number) => Promise<number[]>;
  /** Send `frame:needs` (no resume data). Default: `tabs.sendMessage(tabId, { type: 'frame:needs' }, { frameId })`. */
  sendNeeds?: (tabId: number, frameId: number) => Promise<unknown>;
  /** Send `frame:fill`. Default: `tabs.sendMessage(tabId, msg, { frameId })`. */
  sendFill?: (tabId: number, frameId: number, payload: FramePayload) => Promise<unknown>;
  /** Budget of `frame:fill` per frame. */
  timeoutMs?: number;
  /** Budget of `frame:needs` per frame. */
  needsTimeoutMs?: number;
}

export interface FramePayload {
  runId: string;
  resume: Resume;
  files: Record<string, FileData>;
}

const defaultSendFill = (tabId: number, frameId: number, p: FramePayload): Promise<unknown> =>
  sendToFrame(tabId, frameId, { type: 'frame:fill', ...p });

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

/** Deliver `report:updated` to the top frame (FAB) and to extension pages (side panel). */
export async function broadcastReport(tabId: number, report: FillReport): Promise<void> {
  const message = { type: 'report:updated', tabId, report } as const;
  await Promise.allSettled([
    browser.tabs.sendMessage(tabId, message, { frameId: 0 }),
    browser.runtime.sendMessage(message),
  ]);
}

/** Keep the service worker alive while a long fill runs (any extension API call resets the idle timer). */
function keepAlive(): () => void {
  const timer = setInterval(() => {
    browser.storage.session.get('keepalive').catch(() => undefined);
  }, 20_000);
  return () => clearInterval(timer);
}

const inFlight = new Set<number>();

/** Test hook. */
export const isFillRunning = (tabId: number): boolean => inFlight.has(tabId);

/**
 * Fill one tab. Resolves `{ ok: true }` once the merged report is stored and broadcast, or
 * `{ ok: false, error }` with `no_resume` | `busy` | `no_frames` (no frame has a content script,
 * or none has anything to fill).
 */
export async function runFillRequest(tabId: number, deps: FillDeps = {}): Promise<FillRequestResponse> {
  if (inFlight.has(tabId)) return { ok: false, error: 'busy' };
  inFlight.add(tabId);
  const stop = keepAlive();
  try {
    const resume = await getActiveResume();
    if (!resume) return { ok: false, error: 'no_resume' };
    const runId = crypto.randomUUID();

    const frameIds = await (deps.listFrameIds ?? listFrameIds)(tabId);
    const sendNeeds = deps.sendNeeds ?? defaultSendNeeds;
    const sendFill = deps.sendFill ?? defaultSendFill;
    const parts = await collectFrameReports<FrameNeeds>(
      frameIds,
      // Each frame gets the minimum it asked for: a resume subset and only the files its upload controls take.
      async (frameId, needs) => {
        const payload: FramePayload = {
          runId,
          resume: buildResumeSubset(resume, needs),
          files: await loadAttachmentFiles(resume, needs.attachmentKeys),
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
    if (parts.length === 0) return { ok: false, error: 'no_frames' };

    const report = mergeFrameReports(parts);
    await saveReport(tabId, report);
    await broadcastReport(tabId, report);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    stop();
    inFlight.delete(tabId);
  }
}
