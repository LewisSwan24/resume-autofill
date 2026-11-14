// Shapes shared by the resume import: the file as it arrives, and what reading it gives back. No logic here.
import type { TextLine } from '../../../../src/import/extract/types';
import type { Draft } from '../../../../src/import/parse';
import type { Locale } from '../../../../src/schema';

/** Same limit as an attachment and as the extension's import (src/import/extract/types MAX_FILE_BYTES). */
export const IMPORT_MAX_BYTES = 10 * 1024 * 1024;
export const PDF_MIME = 'application/pdf';
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
/** What the picker offers. */
export const IMPORT_ACCEPT = `.pdf,.docx,${PDF_MIME},${DOCX_MIME}`;

export type ImportKind = 'pdf' | 'docx';
export type ImportSource = 'picker' | 'view' | 'send' | 'attachment';

export interface ImportFile {
  /** Display name, already cleaned (no path, no control characters, at most 128 characters). May be ''. */
  name: string;
  /** As the sender said; may be '' or application/octet-stream. The bytes decide. */
  mimeType: string;
  bytes: Uint8Array;
  source: ImportSource;
  /** Only for source 'attachment': the stored file and the resume whose slot holds it. */
  stored?: { fileId: string; resumeId: string };
}

export type ImportFailure =
  | 'too_large'
  | 'wrong_type'
  | 'old_word'
  | 'empty'
  | 'encrypted'
  | 'no_text'
  | 'nothing_found'
  | 'unreadable'
  | 'failed';

export type ReadPhase = 'reading' | 'recognising';

export interface DetectedLanguage {
  locale: Locale;
  /** Both scripts in strength: the default is shown with a note. */
  mixed: boolean;
}

export interface ReadSuccess {
  ok: true;
  kind: ImportKind;
  /** cleanLines() of what was extracted. DraftField.line indexes into this. */
  lines: TextLine[];
  draft: Draft;
  /** PDF pages read; 1 for Word. */
  pages: number;
  language: DetectedLanguage;
}

/** `locale`: the language the text is in, when the file could be read (nothing_found), so 新建空白简历 can use it. */
export type ReadOutcome = ReadSuccess | { ok: false; reason: ImportFailure | 'cancelled'; locale?: Locale };

export interface ReadOptions {
  signal?: AbortSignal;
  onPhase?: (phase: ReadPhase) => void;
}

export type ResumeReader = (file: ImportFile, options?: ReadOptions) => Promise<ReadOutcome>;
