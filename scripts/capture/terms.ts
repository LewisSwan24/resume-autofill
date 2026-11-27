// The literals a capture must not let through, which no pattern can find: the applicant's name, address and so on.
// They live outside the repository, in ~/.raf-capture/scrub-terms.txt, one per line, and in a resume export.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { resumeTerms } from '../../src/capture/sanitize.ts';

export const captureHome = (): string => path.join(homedir(), '.raf-capture');
export const termsFile = (): string => path.join(captureHome(), 'scrub-terms.txt');

/** scrub-terms.txt, if there is one, and the identifying values of a resume export. Throws when the export cannot be read. */
export function readTerms(resumeExport?: string): string[] {
  const file = termsFile();
  const listed = existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : [];
  const fromResume = resumeExport ? resumeTerms(JSON.parse(readFileSync(resumeExport, 'utf8'))) : [];
  return [...new Set([...listed, ...fromResume])];
}
