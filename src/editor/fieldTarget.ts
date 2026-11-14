// Where on the profile page a fill field lives: the side panel's "Add it to your profile" jumps there.
// A field key is "<module>.<field>" (src/schema/fieldKeys.ts); most name the editor input directly, the rest say
// here which input they come from.
import { ATTACHMENT_SLOTS } from './mutations';
import { MODULES, type ModuleName } from './modules';

export interface ProfileTarget {
  module: ModuleName;
  /** Entry of a list module (education, work...). */
  entry?: number;
  /** Editor field key inside the module (`address.city`), or the attachment slot (`transcriptFileId`). */
  field: string;
}

/** Field keys whose input has another name, or that are worked out from other inputs. */
const SAME_AS: Readonly<Record<string, string>> = {
  'basics.fullName': 'familyName',
  'basics.age': 'birthDate',
  'contact.addressCountry': 'address.country',
  'contact.addressProvince': 'address.province',
  'contact.addressCity': 'address.city',
  'contact.addressDistrict': 'address.district',
  'contact.addressStreet': 'address.street',
  'contact.postcode': 'address.postcode',
  'contact.phoneFull': 'phone',
  'contact.addressFull': 'address.country',
  'contact.inNamedCountry': 'address.country',
  'education.classYear': 'endDate',
};

/** In every list module: a span of dates starts at the start date; "Present" is the box under the end date. */
const IN_ANY_LIST: Readonly<Record<string, string>> = { period: 'startDate', current: 'endDate' };

/** `education[1].school` → 1, when the source is in `module`. */
function entryOf(module: string, source: string | undefined): number {
  const match = source ? /^(\w+)\[(\d+)\]/.exec(source) : null;
  return match && match[1] === module ? Number(match[2]) : 0;
}

export function targetOfField(fieldKey: string, source?: string): ProfileTarget | null {
  const dot = fieldKey.indexOf('.');
  if (dot <= 0) return null;
  const head = fieldKey.slice(0, dot);
  const rest = fieldKey.slice(dot + 1);
  const meta = MODULES.find((m) => m.module === (head === 'misc' ? 'about' : head));
  if (!meta) return null;

  if (meta.container === 'attachments') {
    const slot = `${rest}FileId`;
    return (ATTACHMENT_SLOTS as readonly string[]).includes(slot) ? { module: meta.module, field: slot } : null;
  }

  const own = meta.fields.some((f) => f.key === rest) ? rest : undefined;
  const field = own ?? SAME_AS[fieldKey] ?? (meta.repeatable ? IN_ANY_LIST[rest] : undefined);
  if (!field || !meta.fields.some((f) => f.key === field)) return null;
  return meta.repeatable ? { module: meta.module, entry: entryOf(meta.module, source), field } : { module: meta.module, field };
}
