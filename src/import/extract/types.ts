// What the extractors hand to the parser: lines of text in reading order, each keeping where it came from.

export interface TextLine {
  /** The whole line. */
  text: string;
  /** The stretches of the line with a wide gap between them: a company on the left, its dates on the right. */
  cells: string[];
  /** Page, from 1. A Word document has no pages and says 1. */
  page: number;
  /** Size of the largest text on the line, in points. Zero when the format does not say. */
  fontSize: number;
}

export type ExtractFailure =
  /** The file needs a password. The extension never asks for one. */
  | 'encrypted'
  /** No text to read: most likely a scan. */
  | 'no_text'
  /** The old Word format, or something else that is not a resume file we can read. */
  | 'unsupported'
  | 'too_large'
  | 'failed';

export type ExtractResult = { ok: true; lines: TextLine[]; pages: number } | { ok: false; reason: ExtractFailure };

/** Same limit as an attachment. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
