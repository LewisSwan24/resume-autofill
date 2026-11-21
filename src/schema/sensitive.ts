// Sensitive fields: values a fill writes only when the applicant has said so (settings.sensitiveFields). The one
// list of them lives here; the fill, the frame subset and the report all read it.
import type { FieldKey } from './fieldKeys';

/** How a fill treats a sensitive field: write it like any other, or leave it empty and remind the applicant. */
export const SENSITIVE_FIELD_MODES = ['fill', 'remind'] as const;
export type SensitiveFieldMode = (typeof SENSITIVE_FIELD_MODES)[number];
export const DEFAULT_SENSITIVE_FIELD_MODE: SensitiveFieldMode = 'remind';

/**
 * An identity document's number: 身份证号, a passport number, a Hong Kong, Macau or Taiwan permit number. One key
 * holds them all, with basics.idType saying which document it is.
 */
export const SENSITIVE_FIELD_KEYS: readonly FieldKey[] = ['basics.idNumber'];

const SENSITIVE: ReadonlySet<string> = new Set(SENSITIVE_FIELD_KEYS);

export const isSensitiveFieldKey = (key: FieldKey | null | undefined): boolean => key != null && SENSITIVE.has(key);
