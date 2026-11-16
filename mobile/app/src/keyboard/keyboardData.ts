// KeyboardData v1: the slim projection of the profile that the resume keyboard reads. The app
// builds it (projection.ts), the ResumeKeyboard plugin seals it into files/keyboard.enc, and the keyboard process
// parses it with KeyboardData.java, which mirrors this schema. Plain JSON with no timestamps and no real resume ids,
// so an unchanged profile gives a byte-identical payload.
import { z } from 'zod';

export const KEYBOARD_DATA_VERSION = 1;
export const KEYBOARD_GROUP_IDS = [
  'basics', 'education', 'internship', 'work', 'projects', 'campus', 'awards',
  'skills', 'intention', 'links', 'about', 'other',
] as const;
export const KEYBOARD_KINDS = [
  'email', 'phone', 'url', 'number', 'date', 'name', 'address', 'postcode',
  'school', 'major', 'company', 'position', 'wechat', 'qq',
] as const;
export const KB_LIMITS = {
  resumes: 20,
  itemsPerResume: 600,
  value: 2000,
  label: 60,
  sectionTitle: 60,
  resumeTitle: 40,
  /** Builder target; the native side refuses above 512 KiB. */
  jsonBytes: 480 * 1024,
} as const;

export type KeyboardGroupId = (typeof KEYBOARD_GROUP_IDS)[number];
export type KeyboardKind = (typeof KEYBOARD_KINDS)[number];

export interface KbItem {
  /** `${group}.${sectionIndex}.${field}`, unique within a resume. */
  id: string;
  /** UI language. */
  label: string;
  /** Trimmed, never empty; may contain '\n'. */
  value: string;
  /** For field-aware ordering. */
  kinds: KeyboardKind[];
}
export interface KbSection {
  /** Null for a single-object group's only section. */
  title: string | null;
  /** Short form for TalkBack prefixes and suggested labels: 「第一段」 / "Entry 1". */
  a11y: string | null;
  items: KbItem[];
}
export interface KbGroup {
  id: KeyboardGroupId;
  label: string;
  sections: KbSection[];
}
export interface KbResume {
  /** keyboardResumeId(real id): stays the same when other resumes move. Real resume ids never leave the app. */
  id: string;
  title: string;
  lang: 'zh' | 'en';
  /** Id of the resume the 中/EN toggle goes to. */
  counterpart: string | null;
  /** Non-empty groups only, in KEYBOARD_GROUP_IDS order. */
  groups: KbGroup[];
}
export interface KeyboardData {
  v: 1;
  /** Language of every label and of the keyboard's chrome. */
  ui: 'zh' | 'en';
  defaultResume: string;
  resumes: KbResume[];
}

/** 'r' and an 8-digit hash (keyboardResumeId), or a position when two hashes collide. */
const RESUME_ID = /^r(?:[0-9a-f]{8}|\d{1,2})$/;
const ITEM_ID = /^[a-z]+\.\d{1,3}\.[A-Za-z0-9_.]{1,80}$/;

const ItemSchema = z.strictObject({
  id: z.string().regex(ITEM_ID),
  label: z.string().trim().min(1).max(KB_LIMITS.label),
  value: z.string().min(1).max(KB_LIMITS.value).refine((v) => v.trim() === v && v !== '', 'value must be trimmed and non-empty'),
  kinds: z.array(z.enum(KEYBOARD_KINDS)).max(4),
});
const SectionSchema = z.strictObject({
  title: z.string().min(1).max(KB_LIMITS.sectionTitle).nullable(),
  a11y: z.string().min(1).max(KB_LIMITS.sectionTitle).nullable(),
  items: z.array(ItemSchema).min(1).max(KB_LIMITS.itemsPerResume),
});
const GroupSchema = z.strictObject({
  id: z.enum(KEYBOARD_GROUP_IDS),
  label: z.string().trim().min(1).max(KB_LIMITS.label),
  sections: z.array(SectionSchema).min(1).max(KB_LIMITS.itemsPerResume),
});
const ResumeSchema = z
  .strictObject({
    id: z.string().regex(RESUME_ID),
    title: z.string().trim().min(1).max(KB_LIMITS.resumeTitle),
    lang: z.enum(['zh', 'en']),
    counterpart: z.string().regex(RESUME_ID).nullable(),
    groups: z.array(GroupSchema).min(1).max(KEYBOARD_GROUP_IDS.length),
  })
  .superRefine((r, ctx) => {
    let last = -1;
    for (const g of r.groups) {
      const at = KEYBOARD_GROUP_IDS.indexOf(g.id);
      if (at <= last) ctx.addIssue({ code: 'custom', message: 'groups out of order or repeated', path: ['groups'] });
      last = at;
    }
    const ids = new Set<string>();
    let count = 0;
    for (const g of r.groups) {
      for (const s of g.sections) {
        for (const item of s.items) {
          count += 1;
          if (ids.has(item.id)) ctx.addIssue({ code: 'custom', message: 'duplicate item id', path: ['groups'] });
          ids.add(item.id);
        }
      }
    }
    if (count > KB_LIMITS.itemsPerResume) ctx.addIssue({ code: 'custom', message: 'too many items', path: ['groups'] });
    if (r.counterpart === r.id) ctx.addIssue({ code: 'custom', message: 'a resume is not its own counterpart', path: ['counterpart'] });
  });

export const KeyboardDataSchema: z.ZodType<KeyboardData> = z
  .strictObject({
    v: z.literal(KEYBOARD_DATA_VERSION),
    ui: z.enum(['zh', 'en']),
    defaultResume: z.string().regex(RESUME_ID),
    resumes: z.array(ResumeSchema).min(1).max(KB_LIMITS.resumes),
  })
  .superRefine((d, ctx) => {
    const ids = new Set(d.resumes.map((r) => r.id));
    if (ids.size !== d.resumes.length) ctx.addIssue({ code: 'custom', message: 'duplicate resume id', path: ['resumes'] });
    if (!ids.has(d.defaultResume)) ctx.addIssue({ code: 'custom', message: 'defaultResume names nobody', path: ['defaultResume'] });
    d.resumes.forEach((r, i) => {
      if (r.counterpart !== null && !ids.has(r.counterpart)) {
        ctx.addIssue({ code: 'custom', message: 'counterpart names nobody', path: ['resumes', i, 'counterpart'] });
      }
    });
  });
