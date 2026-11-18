// Messaging protocol between content scripts, the background service worker and extension pages.
// Every message is `{ type: string, ... }`; see docs/plans/2026-11-04-m1-implementation-plan.md §0.5.
import { browser } from 'wxt/browser';
import type { FrameNeeds } from '../engine/fieldDeps';
import type { FieldReport, FillFilter, FillPreview, FillReport, FramePreview } from '../engine/types';
import type { FileData } from '../drivers/types';
import type { Resume, SiteRecipe, SiteRecipeFingerprint } from '../schema';
import type { MappingPresetId } from '../templates/presets';
import type { WizardSessionState } from '../background/wizardSession';

// ------------------------------------------------------------------ messages

/** content script → background */
export type ContentToBg = { type: 'scan:result'; count: number; url: string };

/** background → a specific frame of a tab (via `tabs.sendMessage(tabId, msg, { frameId })`) */
export type BgToFrame =
  | { type: 'scan:total'; total: number }
  /** Ask what the frame could fill (no resume data attached); answered with FrameNeeds. */
  | { type: 'frame:needs' }
  | { type: 'frame:preview'; runId: string; resume: Resume; files: Record<string, FileData>; presetId?: MappingPresetId; recipes?: SiteRecipe[] }
  | { type: 'frame:fill'; runId: string; resume: Resume; files: Record<string, FileData>; filter?: FillFilter; presetId?: MappingPresetId; recipes?: SiteRecipe[] }
  | { type: 'frame:focus'; fieldId: string }
  | { type: 'frame:apply'; fieldId: string; text?: string; optionLabel?: string }
  | { type: 'frame:captureFingerprint'; fieldId: string };

/** FAB / side panel / options → background */
export type UiToBg =
  | { type: 'fill:request' }
  | {
      type: 'fill:commitPreview';
      tabId: number;
      excludedByFrame?: Record<number, string[]>;
      overridesByFrame?: Record<number, Record<string, string>>;
    }
  | { type: 'fill:cancelPreview'; tabId: number }
  /** FAB → background: re-send the current scan:total (the first push can arrive before the FAB listens). */
  | { type: 'scan:query' }
  | { type: 'wizard:query'; tabId?: number }
  | { type: 'wizard:clear'; tabId?: number }
  | { type: 'field:focus'; tabId?: number; frameId: number; fieldId: string }
  | { type: 'field:apply'; tabId: number; frameId: number; fieldId: string; text?: string; optionLabel?: string }
  | { type: 'field:captureFingerprint'; tabId: number; frameId: number; fieldId: string }
  /** Open the profile page; with a field key (and its source path), at that field's input. */
  | { type: 'ui:openOptions'; fieldKey?: string; source?: string }
  | { type: 'ui:openSidePanel' };

/** background → top frame and extension pages (runtime broadcast; no response expected) */
export type BgBroadcast =
  | { type: 'report:updated'; tabId: number; report: FillReport }
  | { type: 'preview:updated'; tabId: number; preview: FillPreview | null }
  | { type: 'wizard:updated'; tabId: number; session: WizardSessionState | null };

export type Message = ContentToBg | BgToFrame | UiToBg | BgBroadcast;
export type MessageType = Message['type'];
/** Messages accepted by the background's `runtime.onMessage` listener. */
export type BgInbound = ContentToBg | UiToBg;

// ------------------------------------------------------------------ responses

export interface FillRequestResponse {
  ok: boolean;
  preview?: boolean;
  error?: string;
}

/** Response payload per message type; messages not listed are fire-and-forget (`void`). */
export interface ResponseMap {
  'fill:request': FillRequestResponse;
  'fill:commitPreview': FillRequestResponse;
  'frame:needs': FrameNeeds;
  'frame:preview': FramePreview;
  'frame:fill': FillReport;
  'field:apply': FieldReport;
  'frame:apply': FieldReport;
  'frame:captureFingerprint': SiteRecipeFingerprint | null;
  'field:captureFingerprint': SiteRecipeFingerprint | null;
  'wizard:query': WizardSessionState | null;
}

export type ResponseFor<M extends { type: string }> = M['type'] extends keyof ResponseMap
  ? ResponseMap[M['type']]
  : void;

/**
 * Runtime list of known message types. The `satisfies` clause below makes the compiler
 * reject a type that is missing from, or not part of, the `Message` union.
 */
const TYPE_TABLE = {
  'scan:result': true,
  'scan:total': true,
  'fill:request': true,
  'fill:commitPreview': true,
  'fill:cancelPreview': true,
  'scan:query': true,
  'wizard:query': true,
  'wizard:clear': true,
  'wizard:updated': true,
  'frame:needs': true,
  'frame:preview': true,
  'frame:fill': true,
  'report:updated': true,
  'preview:updated': true,
  'field:focus': true,
  'frame:focus': true,
  'field:apply': true,
  'frame:apply': true,
  'field:captureFingerprint': true,
  'frame:captureFingerprint': true,
  'ui:openOptions': true,
  'ui:openSidePanel': true,
} as const satisfies Record<MessageType, true>;

export const MESSAGE_TYPES = Object.keys(TYPE_TABLE) as MessageType[];

// ------------------------------------------------------------------ typed senders

/** Send a message to the background service worker (`runtime.sendMessage`). */
export async function sendToBackground<M extends BgInbound>(msg: M): Promise<ResponseFor<M>> {
  return (await browser.runtime.sendMessage(msg)) as ResponseFor<M>;
}

/** Send a message to one frame of one tab (`tabs.sendMessage(tabId, msg, { frameId })`). */
export async function sendToFrame<M extends BgToFrame>(
  tabId: number,
  frameId: number,
  msg: M,
): Promise<ResponseFor<M>> {
  return (await browser.tabs.sendMessage(tabId, msg, { frameId })) as ResponseFor<M>;
}
