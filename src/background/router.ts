// `runtime.onMessage` dispatcher of the background. Pure over injected deps (tests pass fakes).
// Sender rules (see docs plan §0.5):
//   - content scripts (own tab, page url): scan:result, fill:request, field:focus, ui:*
//   - extension pages (side panel / options; may themselves live in a tab): field:focus, field:apply, ui:openOptions
//   - everything else, and foreign senders, is ignored.
import { browser } from 'wxt/browser';
import { isFromExtension, isFromExtensionPage, isValidMessage, sendToFrame, type FillRequestResponse, type Sender } from '../messaging';
import type { FieldReport } from '../engine/types';
import { targetOfField, type ProfileTarget } from '../editor/fieldTarget';
import { openProfileAt } from '../ui/pages';
import { cancelPreviewRequest, commitPreviewRequest, runFillRequest, type PreviewApproval } from './fill';
import { isSectionRow } from './merge';
import { frameSaysAlive, listFrameIds } from './frames';
import { relayApply, relayCaptureFingerprint, relayFocus, type ApplyInput } from './relay';
import { loadScanTotal, recordScan } from './tabState';
import { clearWizardSession, loadWizardSession } from './wizardSession';
import { startAutoAdvance, stopAutoAdvance } from './advanceRun';
import type { SiteRecipeFingerprint } from '../schema';

export type BgSender = Omit<Sender, 'tab'> & { frameId?: number; tab?: { id?: number } };
export type SendResponse = (response?: unknown) => void;

export interface RouterDeps {
  fill(tabId: number): Promise<FillRequestResponse>;
  commitPreview?(tabId: number, approval: PreviewApproval): Promise<FillRequestResponse>;
  cancelPreview?(tabId: number): Promise<void>;
  focus(tabId: number, frameId: number, fieldId: string): Promise<void>;
  apply(input: ApplyInput): Promise<FieldReport | null>;
  captureFingerprint?(tabId: number, frameId: number, fieldId: string): Promise<SiteRecipeFingerprint | null>;
  /** A content script says it is still filling. */
  frameAlive?(tabId: number, frameId: number): void;
  /** Record a frame's count; resolves to the tab total. */
  recordScan(tabId: number, frameId: number, count: number): Promise<number>;
  pushTotal(tabId: number, total: number): Promise<void>;
  /** Stored total over all frames of the tab. */
  currentTotal(tabId: number): Promise<number>;
  /** Must call `sidePanel.open` synchronously (user gesture). */
  openSidePanel(tabId: number): void;
  /** Open the profile page, at one input when there is a target. */
  openOptions(target: ProfileTarget | null): void;
  /** Start auto-advance in a tab; resolves once it has started (or could not), not when it ends. */
  autoAdvance?(tabId: number): Promise<FillRequestResponse>;
  stopAdvance?(tabId: number): void;
}

export const defaultRouterDeps: RouterDeps = {
  fill: (tabId) => runFillRequest(tabId),
  commitPreview: (tabId, approval) => commitPreviewRequest(tabId, approval),
  cancelPreview: (tabId) => cancelPreviewRequest(tabId),
  frameAlive: (tabId, frameId) => frameSaysAlive(tabId, frameId),
  focus: (tabId, frameId, fieldId) => relayFocus(tabId, frameId, fieldId),
  apply: (input) => relayApply(input),
  captureFingerprint: (tabId, frameId, fieldId) => relayCaptureFingerprint(tabId, frameId, fieldId),
  recordScan,
  pushTotal: async (tabId, total) => {
    await sendToFrame(tabId, 0, { type: 'scan:total', total });
  },
  currentTotal: loadScanTotal,
  openSidePanel: (tabId) => {
    // No `await` before this call: `sidePanel.open` needs the user gesture of the click.
    browser.sidePanel?.open?.({ tabId })?.catch(() => undefined);
  },
  openOptions: (target) => openProfileAt(target),
  autoAdvance: (tabId) => startAutoAdvance(tabId),
  stopAdvance: (tabId) => {
    stopAutoAdvance(tabId);
  },
};

const isIndex = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0;
const optionalString = (x: unknown): x is string | undefined => x === undefined || typeof x === 'string';
/** A field key or source path from a page: short, or ignored. */
const isPath = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length <= 200;
const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Build the listener for `browser.runtime.onMessage`. Returns `true` only when it will call `sendResponse` later. */
export function createRouter(deps: RouterDeps = defaultRouterDeps) {
  return (message: unknown, sender: BgSender, sendResponse: SendResponse): boolean => {
    if (!isFromExtension(sender) || !isValidMessage(message)) return false;
    const fromPage = isFromExtensionPage(sender);
    // The tab of a content script. An extension page opened as a tab does not count.
    const contentTabId = !fromPage && isIndex(sender.tab?.id) ? sender.tab.id : undefined;

    switch (message.type) {
      case 'scan:result': {
        if (contentTabId === undefined) return false;
        if (typeof message.count !== 'number' || !Number.isFinite(message.count) || message.count < 0) return false;
        const frameId = isIndex(sender.frameId) ? sender.frameId : 0;
        void deps
          .recordScan(contentTabId, frameId, Math.floor(message.count))
          .then((total) => deps.pushTotal(contentTabId, total))
          .catch(() => undefined); // frame 0 may not have the FAB (yet)
        return false;
      }

      case 'frame:alive': {
        if (contentTabId === undefined) return false;
        deps.frameAlive?.(contentTabId, isIndex(sender.frameId) ? sender.frameId : 0);
        return false;
      }

      case 'scan:query': {
        // Only the FAB (top frame) asks; it missed the first scan:total because it mounts after the scan.
        if (contentTabId === undefined || sender.frameId !== 0) return false;
        void deps
          .currentTotal(contentTabId)
          .then((total) => (total > 0 ? deps.pushTotal(contentTabId, total) : undefined))
          .catch(() => undefined);
        return false;
      }

      case 'fill:request': {
        if (contentTabId === undefined) return false;
        deps.fill(contentTabId).then(sendResponse, (e) => sendResponse({ ok: false, error: errorMessage(e) }));
        return true;
      }

      case 'fill:commitPreview': {
        if (!fromPage || !isIndex(message.tabId)) return false;
        const commit = deps.commitPreview ?? commitPreviewRequest;
        const approval: PreviewApproval = {
          ...(message.excludedByFrame ? { excludedByFrame: message.excludedByFrame } : {}),
          ...(message.overridesByFrame ? { overridesByFrame: message.overridesByFrame } : {}),
        };
        commit(message.tabId, approval).then(sendResponse, (e) => sendResponse({ ok: false, error: errorMessage(e) }));
        return true;
      }

      case 'fill:cancelPreview': {
        if (!fromPage || !isIndex(message.tabId)) return false;
        void (deps.cancelPreview ?? cancelPreviewRequest)(message.tabId).catch(() => undefined);
        return false;
      }

      case 'field:focus': {
        const tabId = fromPage ? message.tabId : contentTabId;
        if (!isIndex(tabId) || !isIndex(message.frameId) || typeof message.fieldId !== 'string') return false;
        if (isSectionRow(message.fieldId)) return false;
        deps.focus(tabId, message.frameId, message.fieldId).catch(() => undefined);
        return false;
      }

      case 'field:apply': {
        if (!fromPage) return false;
        const { tabId, frameId, fieldId, text, optionLabel, undo } = message;
        if (!isIndex(tabId) || !isIndex(frameId) || typeof fieldId !== 'string') return false;
        if (!optionalString(text) || !optionalString(optionLabel)) return false;
        if (isSectionRow(fieldId)) {
          sendResponse(undefined);
          return true;
        }
        const input: ApplyInput = { tabId, frameId, fieldId };
        if (text !== undefined) input.text = text;
        if (optionLabel !== undefined) input.optionLabel = optionLabel;
        if (undo === true) input.undo = true;
        deps.apply(input).then(
          (field) => sendResponse(field ?? undefined),
          () => sendResponse(undefined),
        );
        return true;
      }

      case 'field:captureFingerprint': {
        if (!fromPage || !isIndex(message.tabId) || !isIndex(message.frameId) || typeof message.fieldId !== 'string') return false;
        const capture = deps.captureFingerprint ?? relayCaptureFingerprint;
        capture(message.tabId, message.frameId, message.fieldId).then(
          (fp) => sendResponse(fp ?? null),
          () => sendResponse(null),
        );
        return true;
      }

      case 'wizard:query': {
        const tabId = fromPage ? message.tabId : contentTabId;
        if (!isIndex(tabId)) return false;
        loadWizardSession(tabId).then(sendResponse, () => sendResponse(null));
        return true;
      }

      case 'wizard:clear': {
        const tabId = fromPage ? message.tabId : contentTabId;
        if (!isIndex(tabId)) return false;
        (deps.stopAdvance ?? defaultRouterDeps.stopAdvance)?.(tabId);
        void clearWizardSession(tabId).catch(() => undefined);
        return false;
      }

      case 'wizard:autoAdvance': {
        // From the FAB (top frame of its own tab) or an extension page naming the tab.
        const tabId = fromPage ? message.tabId : sender.frameId === 0 ? contentTabId : undefined;
        if (!isIndex(tabId)) return false;
        const start = deps.autoAdvance ?? defaultRouterDeps.autoAdvance!;
        start(tabId).then(sendResponse, (e) => sendResponse({ ok: false, error: errorMessage(e) }));
        return true;
      }

      case 'wizard:stopAdvance': {
        const tabId = fromPage ? message.tabId : contentTabId;
        if (!isIndex(tabId)) return false;
        (deps.stopAdvance ?? defaultRouterDeps.stopAdvance)?.(tabId);
        return false;
      }

      case 'inspector:start': {
        if (!fromPage || !isIndex(message.tabId)) return false;
        const tabId = message.tabId;
        void listFrameIds(tabId)
          .then((frames) =>
            Promise.allSettled(frames.map((fid) => sendToFrame(tabId, fid, { type: 'frame:inspectorStart' }))),
          )
          .catch(() => undefined);
        return false;
      }

      case 'inspector:stop': {
        if (!fromPage || !isIndex(message.tabId)) return false;
        const tabId = message.tabId;
        void Promise.allSettled([
          sendToFrame(tabId, 0, { type: 'inspector:hover', target: null } as never),
          listFrameIds(tabId).then((frames) =>
            Promise.allSettled(frames.map((fid) => sendToFrame(tabId, fid, { type: 'frame:inspectorStop' }))),
          ),
        ]).catch(() => undefined);
        return false;
      }

      case 'inspector:hover': {
        if (contentTabId === undefined) return false;
        void browser.tabs.sendMessage(contentTabId, { type: 'inspector:hover', target: message.target }, { frameId: 0 }).catch(() => undefined);
        return false;
      }

      case 'inspector:picked': {
        if (contentTabId === undefined) return false;
        const tabId = contentTabId;
        const payload = { type: 'inspector:picked', tabId, url: message.url, target: message.target } as const;
        void Promise.allSettled([
          browser.storage.session.set({ [`inspectorPick:${tabId}`]: { url: message.url, target: message.target, at: Date.now() } }),
          browser.tabs.sendMessage(tabId, { type: 'inspector:hover', target: null }, { frameId: 0 }),
          listFrameIds(tabId).then((frames) =>
            Promise.allSettled(frames.map((fid) => sendToFrame(tabId, fid, { type: 'frame:inspectorStop' }))),
          ),
          browser.runtime.sendMessage(payload),
        ]).catch(() => undefined);
        return false;
      }

      case 'ui:openSidePanel': {
        if (contentTabId === undefined) return false;
        deps.openSidePanel(contentTabId); // synchronous on purpose
        return false;
      }

      case 'ui:openOptions': {
        // Anything malformed still opens the page, just not at an input.
        const { fieldKey, source } = message;
        const sourceOk = source === undefined || isPath(source);
        deps.openOptions(isPath(fieldKey) && sourceOk ? targetOfField(fieldKey, source) : null);
        return false;
      }

      default:
        // scan:total, frame:*, report:updated are not for the background.
        return false;
    }
  };
}
