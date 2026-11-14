// Where a draft path lives in the editor: its module, its entry, its field and the words that label it.
import { MODULES, type FieldMeta, type ModuleMeta, type ModuleName } from '../../../../src/editor';

export interface PathInfo {
  module: ModuleName; // 'about' for the root fields selfIntroduction and hobbies
  meta: ModuleMeta;
  /** Draft entry index for list modules, else null. */
  entry: number | null;
  /** The editor field this path belongs to, or null when the editor has none (then the item is never shown or written). */
  field: FieldMeta | null;
  /** For region fields (nativePlace...): 'province' | 'city' | 'district'. */
  part: string | null;
  /** Label keys to join with ' · ': [field.labelKey] or [field.labelKey, 'options.region.<part>']. */
  labelKeys: string[];
  hidden: boolean; // current, kind
}

/** Not shown: whether a job is current follows from its end date, and its kind from its section. */
const HIDDEN = new Set(['current', 'kind']);
const REGION_PARTS = new Set(['province', 'city', 'district']);
const ROOT_FIELDS = new Set(['selfIntroduction', 'hobbies']);

export function describePath(path: string): PathInfo | null {
  const segments = path.split('.');
  if (segments.some((s) => s === '')) return null;
  const first = segments[0]!;
  const module = (ROOT_FIELDS.has(first) ? 'about' : first) as ModuleName;
  const meta = MODULES.find((m) => m.module === module);
  if (!meta || meta.container === 'attachments') return null;

  let entry: number | null = null;
  let rest: string[];
  if (meta.container === 'root') {
    rest = segments;
  } else if (meta.container === 'array') {
    if (!/^\d+$/.test(segments[1] ?? '')) return null;
    entry = Number(segments[1]);
    rest = segments.slice(2);
  } else {
    rest = segments.slice(1);
  }
  if (rest.length === 0) return null;
  const key = rest.join('.');

  if (meta.container === 'array' && rest.length === 1 && HIDDEN.has(key)) {
    const field = meta.fields.find((f) => f.key === key) ?? null;
    return { module, meta, entry, field, part: null, labelKeys: field ? [field.labelKey] : [], hidden: true };
  }

  const exact = meta.fields.find((f) => f.key === key);
  if (exact) {
    // A skill is its name: the row says 技能, as the options page does.
    const labelKeys = module === 'skills' && key === 'name' ? [meta.labelKey] : [exact.labelKey];
    return { module, meta, entry, field: exact, part: null, labelKeys, hidden: false };
  }

  const region = meta.fields.find((f) => f.input === 'region' && f.key === rest[0]);
  if (region && rest.length === 2 && REGION_PARTS.has(rest[1]!)) {
    const part = rest[1]!;
    return { module, meta, entry, field: region, part, labelKeys: [region.labelKey, `options.region.${part}`], hidden: false };
  }
  return null;
}
