// `fill:request` orchestration: resume + files → every frame (sequentially) → merged report → store → notify.
import { browser } from 'wxt/browser';
import type { FileData } from '../drivers/types';
import type { FillReport } from '../engine/types';
import { sendToFrame, type FillRequestResponse } from '../messaging';
import type { Resume } from '../schema';
import { fileToFileData, getActiveResume, getFile } from '../storage';
import { FRAME_TIMEOUT_MS, collectFrameReports, listFrameIds } from './frames';
import { mergeFrameReports } from './merge';
import { saveReport } from './tabState';

export interface FillDeps {
  /** Frame ids to ask, top frame first. Default: `webNavigation.getAllFrames`. */
  listFrameIds?: (tabId: number) => Promise<number[]>;
  /** Send `frame:fill`. Default: `tabs.sendMessage(tabId, msg, { frameId })`. */
  sendFill?: (tabId: number, frameId: number, payload: FramePayload) => Promise<unknown>;
  timeoutMs?: number;
}

export interface FramePayload {
  runId: string;
  resume: Resume;
  files: Record<string, FileData>;
}

const defaultSendFill = (tabId: number, frameId: number, p: FramePayload): Promise<unknown> =>
  sendToFrame(tabId, frameId, { type: 'frame:fill', ...p });

/** Ids of the files a resume references. */
export function attachmentIds(resume: Resume): string[] {
  const a = resume.attachments;
  return [a.resumeFileId, a.photoFileId, a.transcriptFileId].filter((id): id is string => !!id);
}

/** Load the resume's attachments as driver-ready data. Missing / unreadable files are left out. */
export async function loadAttachmentFiles(resume: Resume): Promise<Record<string, FileData>> {
  const files: Record<string, FileData> = {};
  for (const id of new Set(attachmentIds(resume))) {
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
 * `{ ok: false, error }` with `no_resume` | `busy` | `no_frames` (no frame has a content script).
 */
export async function runFillRequest(tabId: number, deps: FillDeps = {}): Promise<FillRequestResponse> {
  if (inFlight.has(tabId)) return { ok: false, error: 'busy' };
  inFlight.add(tabId);
  const stop = keepAlive();
  try {
    const resume = await getActiveResume();
    if (!resume) return { ok: false, error: 'no_resume' };
    const files = await loadAttachmentFiles(resume);
    const payload: FramePayload = { runId: crypto.randomUUID(), resume, files };

    const frameIds = await (deps.listFrameIds ?? listFrameIds)(tabId);
    const sendFill = deps.sendFill ?? defaultSendFill;
    const parts = await collectFrameReports(frameIds, (frameId) => sendFill(tabId, frameId, payload), {
      timeoutMs: deps.timeoutMs ?? FRAME_TIMEOUT_MS,
    });
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
