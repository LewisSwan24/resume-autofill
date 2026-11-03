// Inline validation: map zod issues of a profile to `resumes.<index>.<path>` strings.
import { ProfileSchema, type Profile } from '../schema';

export interface FieldIssue {
  /** Dotted path from the profile root, e.g. `resumes.0.education.1.startDate`. */
  path: string;
  message: string;
}

export function validateProfile(profile: Profile): FieldIssue[] {
  const result = ProfileSchema.safeParse(profile);
  if (result.success) return [];
  return result.error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
}

/** Issues of resume `index` keyed by path relative to the resume (`basics.height`). */
export function issuesForResume(issues: readonly FieldIssue[], index: number): Map<string, string> {
  const prefix = `resumes.${index}.`;
  const map = new Map<string, string>();
  for (const issue of issues) {
    if (issue.path.startsWith(prefix) && !map.has(issue.path.slice(prefix.length))) {
      map.set(issue.path.slice(prefix.length), issue.message);
    }
  }
  return map;
}
