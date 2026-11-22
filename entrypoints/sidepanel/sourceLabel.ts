// Human-readable "where did this value come from" for the side panel.
// The engine reports a resume path such as `basics.familyName+givenName`, `education[1].school` or
// `contact.address.city`. People should read "Basics › Family name + Given name" instead; the raw path stays
// available as a tooltip only. Labels come from the options editor metadata (`src/editor/modules.ts`) and the
// `options.*` i18n keys, so the wording matches the settings page. Pure: no React, no browser APIs.
import { MODULES, type FieldMeta, type ModuleMeta } from '../../src/editor/modules';
import type { MessageKey } from '../../src/i18n';

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

/** `attachments.<prop>` (resume path) → options.attach.* label key. */
const ATTACHMENT_LABEL: Readonly<Record<string, MessageKey>> = {
  resumeFileId: 'options.attach.resume',
  photoFileId: 'options.attach.photo',
  transcriptFileId: 'options.attach.transcript',
  portfolioFileId: 'options.attach.portfolio',
};

const PATH_HEAD = /^([A-Za-z]+)(?:\[(\d+)\])?(?:\.(.+))?$/;
/** The rest of a path into a list inside an entry: `tests[1].score`. */
const SUB_ITEM = /^([A-Za-z]+)\[(\d+)\]\.([A-Za-z]+)$/;

const moduleOf = (name: string): ModuleMeta | undefined => MODULES.find((m) => m.module === name);
const fieldOf = (module: ModuleMeta, key: string): FieldMeta | undefined => module.fields.find((f) => f.key === key);

/**
 * Label of a resume path, or `null` when the path is not known to the editor metadata (the caller then falls back
 * to the raw path).
 */
export function describeSource(path: string, t: Translate): string | null {
  const parts = path.split('+').map((p) => p.trim());
  const head = PATH_HEAD.exec(parts[0] ?? '');
  if (!head) return null;
  const [, first, index, rest] = head;

  // Paths without a dot are top-level resume fields (`selfIntroduction`, `hobbies`): the "About me" module.
  const module = rest === undefined ? moduleOf('about') : moduleOf(first!);
  if (!module) return null;
  const moduleName = t(module.labelKey as MessageKey) + (index !== undefined ? ` ${Number(index) + 1}` : '');

  // An item of a list inside the entry (a language's tests). Of several tests joined, the first names the source.
  const item = rest === undefined ? null : SUB_ITEM.exec(rest);
  if (item) {
    const sub = module.subLists?.find((s) => s.key === item[1]);
    const meta = sub?.fields.find((f) => f.key === item[3]);
    if (!sub || !meta) return null;
    return `${moduleName} › ${t(sub.itemLabelKey as MessageKey, { n: Number(item[2]) + 1 })} › ${t(meta.labelKey as MessageKey)}`;
  }
  const keys = rest === undefined ? [first!] : [rest, ...parts.slice(1)];

  const labels: string[] = [];
  for (const key of keys) {
    if (module.module === 'attachments') {
      const labelKey = ATTACHMENT_LABEL[key];
      if (!labelKey) return null;
      labels.push(t(labelKey));
    } else if (module.module === 'contact' && key === 'address') {
      labels.push(t('panel.source.address'));
    } else {
      const meta = fieldOf(module, key);
      if (!meta) return null;
      labels.push(t(meta.labelKey as MessageKey));
    }
  }

  return `${moduleName} › ${labels.join(' + ')}`;
}
