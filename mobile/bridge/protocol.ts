// The bridge between the fill browser's page frames (mobile/inject/entry.ts) and the app (browser/model/*).
// Every message is a JSON string of one object with `v: 1` and a `kind`. Both sides decode with these zod schemas;
// anything that does not parse is dropped (decoders return null and never throw). The page can never ask for resume
// data: there is no such kind. Imported by the page bundle and by the app, so it stays free of DOM and platform code.
import { z } from 'zod';
import { REPEAT_SECTIONS, isAttachmentKey, parseFrameNeeds, type FrameNeeds } from '../../src/engine/fieldDeps';
import { OUTCOMES } from '../../src/engine/types';
import { getFieldKeyDef, type SectionKey } from '../../src/schema/fieldKeys';
import { ResumeSchema } from '../../src/schema/resume';
import { SENSITIVE_FIELD_MODES } from '../../src/schema/sensitive';

export const PROTOCOL_VERSION = 1;
export const MAX_PAGE_MESSAGE_CHARS = 512_000;
export const MAX_FRAMES = 32;
export const MAX_REPORT_ROWS = 1000;
export const MAX_LABEL = 300;
export const MAX_VALUE = 2000;
export const MAX_CANDIDATES = 20;
/** Entries of one section a report may number. */
export const MAX_ENTRY_INDEX = 199;
export const MAX_NEEDS_KEYS = 400;
export const MAX_OBSTACLES = 16;
export const MAX_SCAN_COUNT = 5000;
export const MAX_REQ_ID = 64;
export const MAX_FILES = 3;
export const MAX_DATA_URL_CHARS = 15_000_000;

const SECTION_KEYS = [
  'basics', 'contact', 'jobIntention', 'education', 'work', 'internship', 'projects', 'campus', 'awards', 'languages',
  'certificates', 'skills', 'family', 'emergencyContact', 'referees', 'workRights', 'diversity', 'selfIntro',
  'attachments', 'other',
] as const satisfies readonly SectionKey[];

const knownKey = (k: string) => isAttachmentKey(k) || getFieldKeyDef(k) !== undefined;
const REPEATED: ReadonlySet<string> = new Set(REPEAT_SECTIONS);

const base = { v: z.literal(PROTOCOL_VERSION) };
const reqId = z.string().min(1).max(MAX_REQ_ID);
const fieldId = z.string().min(1).max(64);
const box = z.strictObject({ left: z.number(), top: z.number(), right: z.number(), bottom: z.number() });

/** What a frame could fill. Unknown keys, sections or attachment names fail the whole message. */
export const FrameNeedsShape = z
  .strictObject({
    fieldKeys: z.array(z.string().max(100)).max(MAX_NEEDS_KEYS),
    repeatSections: z.array(z.string().max(40)).max(20),
    attachmentKeys: z.array(z.string().max(40)).max(3),
  })
  .refine(
    (n) => n.fieldKeys.every(knownKey) && n.repeatSections.every((s) => REPEATED.has(s)) && n.attachmentKeys.every(isAttachmentKey),
    { message: 'unknown key' },
  )
  .transform((n): FrameNeeds => parseFrameNeeds(n)!);

const FieldReportShape = z.strictObject({
  fieldId,
  label: z.string().max(MAX_LABEL),
  fieldKey: z.string().max(100).refine(knownKey).nullable(),
  section: z.enum(SECTION_KEYS).nullable(),
  outcome: z.enum(OUTCOMES as unknown as readonly [string, ...string[]]).transform((o) => o as (typeof OUTCOMES)[number]),
  confidence: z.number().min(0).max(1),
  value: z.string().max(MAX_VALUE).optional(),
  observed: z.string().max(MAX_VALUE).nullable().optional(),
  source: z.string().max(200).optional(),
  candidates: z
    .array(
      z.strictObject({
        label: z.string().max(MAX_LABEL),
        value: z.string().max(MAX_VALUE).optional(),
        fieldKey: z.string().max(100).refine(knownKey).optional(),
      }),
    )
    .max(MAX_CANDIDATES)
    .optional(),
  note: z.enum(['same_file_held', 'entry_held', 'picked_other_name', 'sensitive_held', 'sensitive_filled']).optional(),
  entry: z.number().int().min(0).max(MAX_ENTRY_INDEX).optional(),
});

const EntryProgressShape = z.strictObject({
  section: z.enum(SECTION_KEYS),
  index: z.number().int().min(0).max(MAX_ENTRY_INDEX),
  state: z.enum(['existing', 'added', 'skipped', 'held']),
  reason: z.enum(['no_button', 'add_failed', 'max_adds', 'editor_held', 'no_name', 'nothing_to_fill']).optional(),
  label: z.string().max(MAX_LABEL).optional(),
  button: z.string().max(MAX_LABEL).optional(),
});

/** Counts travel along but the app recomputes them (countOutcomes); only the shape is checked. */
export const FillReportShape = z.strictObject({
  url: z.string().max(2048),
  startedAt: z.number(),
  finishedAt: z.number(),
  fields: z.array(FieldReportShape).max(MAX_REPORT_ROWS),
  counts: z.record(z.enum(OUTCOMES as unknown as readonly [string, ...string[]]), z.number().int().min(0)),
  entries: z.array(EntryProgressShape).max(MAX_REPORT_ROWS).optional(),
});

/** What the top frame says about the step it shows (auto-advance; src/background/autoAdvance.ts StepState). */
const StepStateShape = z.strictObject({
  url: z.string().max(2048),
  fingerprint: z.string().max(200),
  action: z.enum(['next', 'disabled', 'final', 'ambiguous', 'none']),
  blocker: z.enum(['needs_you', 'verification']).nullable(),
  userInputAt: z.number().min(0),
  /** The name the page gives this step; null when it marks none. */
  title: z.string().max(MAX_LABEL).nullable(),
});

/** Why a Next was not pressed: the stops the page itself can tell (a subset of AdvanceStop). */
export const PRESS_STOPS = ['needs_you', 'verification', 'final_step', 'no_next', 'ambiguous'] as const;

const viewport = z.strictObject({
  width: z.number().positive(),
  height: z.number().positive(),
  offsetLeft: z.number(),
  offsetTop: z.number(),
  scale: z.number().positive(),
});

export const PageMessageSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...base, kind: z.literal('hello'), iframes: z.number().int().min(0).max(MAX_FRAMES) }),
  z.strictObject({
    ...base,
    kind: z.literal('scan'),
    count: z.number().int().min(0).max(MAX_SCAN_COUNT),
    iframes: z.number().int().min(0).max(MAX_FRAMES),
  }),
  z.strictObject({ ...base, kind: z.literal('needs'), reqId, needs: FrameNeedsShape }),
  z.strictObject({ ...base, kind: z.literal('report'), reqId, runId: reqId, report: FillReportShape }),
  z.strictObject({ ...base, kind: z.literal('focused'), reqId, ok: z.boolean() }),
  z.strictObject({
    ...base,
    kind: z.literal('undone'),
    reqId,
    runId: reqId,
    restored: z.array(z.string().max(64)).max(MAX_REPORT_ROWS),
    manual: z.array(z.string().max(64)).max(MAX_REPORT_ROWS),
    addedCards: z.number().int().min(0).max(500),
  }),
  z.strictObject({ ...base, kind: z.literal('obstacles'), boxes: z.array(box).max(MAX_OBSTACLES), viewport }),
  z.strictObject({ ...base, kind: z.literal('error'), reqId, code: z.enum(['fill_failed', 'undo_failed', 'bad_payload', 'wrong_origin']) }),
  z.strictObject({ ...base, kind: z.literal('bye') }),
  z.strictObject({ ...base, kind: z.literal('step'), reqId, state: StepStateShape }),
  z.strictObject({ ...base, kind: z.literal('pressed'), reqId, pressed: z.boolean(), reason: z.enum(PRESS_STOPS).optional() }),
]);

export const FileDataShape = z.strictObject({
  name: z.string().max(255),
  type: z.string().max(100),
  dataUrl: z.string().max(MAX_DATA_URL_CHARS).startsWith('data:'),
});

export const AppCommandSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...base, kind: z.literal('needs'), reqId }),
  z.strictObject({
    ...base,
    kind: z.literal('fill'),
    reqId,
    runId: reqId,
    /** The origin the person agreed to send this to; a document with any other origin refuses the fill. */
    origin: z.string().max(2048),
    resume: ResumeSchema,
    files: z.record(z.string().max(64), FileDataShape).refine((f) => Object.keys(f).length <= MAX_FILES),
    /** settings.sensitiveFields; absent means the default, remind. */
    sensitiveFields: z.enum(SENSITIVE_FIELD_MODES).optional(),
    /** Fill only these fields (「这次填上」); the page keeps the last full fill's undo. */
    only: z.array(fieldId).min(1).max(MAX_REPORT_ROWS).optional(),
  }),
  z.strictObject({ ...base, kind: z.literal('focus'), reqId, fieldId: z.string().max(64) }),
  z.strictObject({ ...base, kind: z.literal('undo'), reqId, runId: reqId }),
  z.strictObject({ ...base, kind: z.literal('clear') }),
  /** Top frame only: which step is showing. */
  z.strictObject({ ...base, kind: z.literal('step'), reqId }),
  /** Top frame only: press the page's own Next button, never one that sends the application. */
  z.strictObject({ ...base, kind: z.literal('press'), reqId }),
]);

export type PageMessage = z.output<typeof PageMessageSchema>;
export type PageMessageInput = z.input<typeof PageMessageSchema>;
export type AppCommand = z.output<typeof AppCommandSchema>;
export type AppCommandInput = z.input<typeof AppCommandSchema>;
export type PageMessageOf<K extends PageMessage['kind']> = Extract<PageMessage, { kind: K }>;
export type AppCommandOf<K extends AppCommand['kind']> = Extract<AppCommand, { kind: K }>;

/** JSON text of one message or command. */
export function encode(value: PageMessageInput | AppCommandInput): string {
  return JSON.stringify(value);
}

const MAX_COMMAND_CHARS = MAX_FILES * MAX_DATA_URL_CHARS + MAX_PAGE_MESSAGE_CHARS;

function parseJson(text: unknown, maxChars = MAX_PAGE_MESSAGE_CHARS): unknown {
  if (typeof text !== 'string' || text.length > maxChars) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function decodeWith<S extends z.ZodType>(schema: S, text: unknown, maxChars: number): z.output<S> | null {
  if (typeof text !== 'string' || text.length > maxChars) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  try {
    const result = schema.safeParse(value);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/** A page → app message, or null (dropped, never answered). */
export function decodePageMessage(text: string): PageMessage | null {
  return decodeWith(PageMessageSchema, text, MAX_PAGE_MESSAGE_CHARS);
}

/** An app → page command, or null. Commands carry files, so their own limit is the data URL budget. */
export function decodeAppCommand(text: string): AppCommand | null {
  return decodeWith(AppCommandSchema, text, MAX_COMMAND_CHARS);
}

/** A hello from an engine that speaks another protocol version: the frame is there but cannot be used. */
export function isIncompatibleHello(text: string): boolean {
  const value = parseJson(text);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const o = value as Record<string, unknown>;
  return o.kind === 'hello' && o.v !== PROTOCOL_VERSION;
}

/** The request id of a command that failed to parse, when that much of it is readable (for `bad_payload`). */
export function readableReqId(text: string): string | null {
  const value = parseJson(text, MAX_COMMAND_CHARS);
  if (typeof value !== 'object' || value === null) return null;
  const o = value as Record<string, unknown>;
  if (o.v !== PROTOCOL_VERSION || o.kind !== 'fill') return null;
  const parsed = reqId.safeParse(o.reqId);
  return parsed.success ? parsed.data : null;
}
