// A draft is a flat list of what was read, by path into a Resume. Nothing here is stored until the applicant says so.

/** high: the format or a clear label proves it. check: inferred from layout or words, shown in yellow. */
export type Certainty = 'high' | 'check';

export interface DraftField {
  /** `contact.email`, `education.0.school`. A few read-time names (`name`, `location`) are settled before the draft is done. */
  path: string;
  value: string;
  certainty: Certainty;
  /** Index of the line it came from, so the review page can show the source. */
  line: number;
}

export interface Draft {
  locale: 'zh-CN' | 'en-AU';
  fields: DraftField[];
}
