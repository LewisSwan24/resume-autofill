// `frame:needs`: what this frame could fill, computed by the same scan runFill uses but without any resume.
// The background answers with a minimal resume subset (see background/subset.ts), so everything listed
// here must cover what a fill run may touch, and nothing more.
import { resolveAdapter } from '../adapters/resolve';
import { FILL_THRESHOLD, REVIEW_THRESHOLD } from '../engine/classify';
import {
  REPEAT_SECTIONS,
  isAttachmentKey,
  type AttachmentKey,
  type FrameNeeds,
} from '../engine/fieldDeps';
import { scanDocument } from '../engine/scan';
import type { FieldKey, SectionKey } from '../engine/types';
import { findAddButtons } from '../fill/ensureCards';
import { getFieldKeyDef } from '../schema/fieldKeys';

/** Float slack: confidences are rounded to 3 decimals. */
const EPS = 1e-9;
const REPEATED: ReadonlySet<SectionKey> = new Set(REPEAT_SECTIONS);

/**
 * - `fieldKeys`: keys classified at or above the review threshold (so review candidates still show);
 *   `never_fill` controls are left out. Upload keys go to `attachmentKeys` instead.
 * - `attachmentKeys`: an upload key counts only when a real file control is classified at fill confidence
 *   (a file is never sent for a field that would merely be offered for review).
 * - `repeatSections`: repeated sections of the page's controls (when the frame recognises any field at
 *   all) plus every section an add button belongs to (`ensureCards` clicks those even when no card exists
 *   yet). A frame with no recognised field and no add button needs nothing.
 */
export function computeFrameNeeds(doc: Document, idFor?: (el: HTMLElement) => string): FrameNeeds {
  const { contexts, classifications } = scanDocument(doc, idFor);
  const fieldKeys = new Set<FieldKey>();
  const attachmentKeys = new Set<AttachmentKey>();
  const sections = new Set<SectionKey>();

  classifications.forEach((cls, i) => {
    if (cls.reason === 'never_fill' || !cls.fieldKey || !getFieldKeyDef(cls.fieldKey)) return;
    if (cls.confidence < REVIEW_THRESHOLD - EPS) return;
    if (isAttachmentKey(cls.fieldKey)) {
      if (cls.confidence >= FILL_THRESHOLD - EPS && contexts[i]?.control.kind === 'file') attachmentKeys.add(cls.fieldKey);
    } else {
      fieldKeys.add(cls.fieldKey);
      // A work with no file of its own takes the portfolio file.
      if (cls.fieldKey === 'works.fileId' && cls.confidence >= FILL_THRESHOLD - EPS && contexts[i]?.control.kind === 'file') {
        attachmentKeys.add('attachments.portfolio');
      }
    }
  });

  if (fieldKeys.size > 0 || attachmentKeys.size > 0) {
    for (const cls of classifications) {
      if (cls.section && REPEATED.has(cls.section)) sections.add(cls.section);
    }
  }
  for (const b of findAddButtons(doc)) {
    if (b.section && REPEATED.has(b.section)) sections.add(b.section);
  }

  // Fields that are not on the page until an editor opens.
  for (const editor of resolveAdapter(doc)?.editors ?? []) {
    if (!doc.querySelector(editor.root)) continue;
    sections.add(editor.section);
    for (const key of editor.fields) fieldKeys.add(key);
  }

  return { fieldKeys: [...fieldKeys], repeatSections: [...sections], attachmentKeys: [...attachmentKeys] };
}
