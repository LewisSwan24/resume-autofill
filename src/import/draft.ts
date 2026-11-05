// A checked draft to a Resume. Whatever does not fit the schema is left out, and nothing is stored from here.
import { ResumeSchema, type Resume } from '../schema';
import type { Draft, DraftField } from './parse';

type Bag = Record<string, unknown>;

const LIST_MODULES = new Set(['education', 'work', 'projects', 'skills']);
const BOOLEAN_FIELDS = new Set(['current']);

function put(root: Bag, path: string, value: string): void {
  const parts = path.split('.');
  let bag: Bag | unknown[] = root;
  parts.forEach((part, i) => {
    const key = /^\d+$/.test(part) ? Number(part) : part;
    if (i === parts.length - 1) {
      (bag as Bag)[key] = BOOLEAN_FIELDS.has(part) ? value === 'true' : value;
      return;
    }
    const next = (bag as Bag)[key];
    if (next === undefined) {
      const child: Bag | unknown[] = LIST_MODULES.has(part) ? [] : {};
      (bag as Bag)[key] = child;
      bag = child;
    } else {
      bag = next as Bag;
    }
  });
}

/** Drop any path whose value the schema refuses, one at a time, so one bad date does not lose the whole file. */
function acceptable(fields: DraftField[], base: Bag): DraftField[] {
  return fields.filter((f) => {
    const bag: Bag = structuredClone(base);
    put(bag, f.path, f.value);
    const dense = withoutHoles(bag);
    return ResumeSchema.safeParse(dense).success;
  });
}

function withoutHoles(bag: Bag): Bag {
  const out: Bag = { ...bag };
  for (const key of LIST_MODULES) {
    const list = out[key];
    if (Array.isArray(list)) out[key] = list.filter((x) => x !== undefined && x !== null);
  }
  return out;
}

/** What the applicant would lose without being told: a value the schema refuses, as typed. */
export function refusedPaths(draft: Draft, identity: { id: string; title: string }): string[] {
  const contact = { phoneCountryCode: draft.locale === 'en-AU' ? '+61' : '+86' };
  const base: Bag = { contact, id: identity.id, title: identity.title, locale: draft.locale, createdAt: 0, updatedAt: 0 };
  const filled = draft.fields.filter((x) => x.value.trim());
  const accepted = new Set(acceptable(filled, base));
  return filled.filter((x) => !accepted.has(x)).map((x) => x.path);
}

export function draftToResume(draft: Draft, identity: { id: string; title: string; now?: number }): Resume {
  const now = identity.now ?? Date.now();
  // A phone with no code in the file takes the one that goes with the language, as a new resume does by hand.
  const contact = { phoneCountryCode: draft.locale === 'en-AU' ? '+61' : '+86' };
  const base: Bag = { contact, id: identity.id, title: identity.title, locale: draft.locale, createdAt: now, updatedAt: now };
  const bag: Bag = structuredClone(base);
  for (const f of acceptable(draft.fields.filter((x) => x.value.trim()), base)) put(bag, f.path, f.value.trim());
  return ResumeSchema.parse(withoutHoles(bag));
}
