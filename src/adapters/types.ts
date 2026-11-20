// What a site can tell the general engine, as data. Every entry here comes from a real page that the
// engine could not read by itself; a site the engine already reads needs no adapter.
import type { SectionKey } from '../engine/types';
import type { FieldKey } from '../schema';

/** A question whose text sits outside any label: the text becomes the label of its control. */
export interface QuestionLabel {
  /** Controls this applies to. */
  control: string;
  /** The box around one question and its control. */
  within: string;
  /** Inside `within`: the element holding the question. */
  text: string;
}

/** A control whose own label says something else than what it is for. This text replaces all it says. */
export interface FixedLabel {
  control: string;
  label: string;
}

/** A text box that keeps only a result picked from its search, built without ARIA roles. */
export interface SearchBox {
  input: string;
  /** The box around the input and its results. */
  within: string;
  /** One result. */
  option: string;
  /** A hidden input the page sets when a result is picked. Empty means nothing was picked. */
  picked?: string;
}

/** A plain input that takes an answer only by picking from a list, shown afterwards as a pill. */
export interface PromptBox {
  input: string;
  /** The box around the input and its pills. */
  within: string;
  /** The list while it is open, anywhere on the page. */
  list: string;
  option: string;
  /** Inside an option: says it is an answer and not a folder of more options. */
  leaf: string;
  /** Inside `within`: the text of a choice already made. */
  chosen: string;
}

/** Names a file the page already holds. The element's attribute reads `prefix` and then the file name. */
export interface HeldFile {
  selector: string;
  attribute: string;
  prefix: string;
}

/** A repeated section filled one entry at a time: `add` opens an editor, `save` closes it into a list. */
export interface EntryEditor {
  section: SectionKey;
  /** What the section is called, for a page whose heading the engine cannot see. */
  title: string;
  root: string;
  /** All inside `root`. */
  add: string;
  editor: string;
  save: string;
  cancel: string;
  /** One saved entry. */
  saved: string;
  /** Field of a resume entry → where a saved entry shows it. Together they tell one entry from another. */
  identity: Record<string, string>;
  /** What the editor can take. The fields are not on the page until it opens. */
  fields: FieldKey[];
  /** The page puts each new entry above the others. */
  addsOnTop?: boolean;
}

export interface AtsAdapter {
  id: string;
  match: {
    /** `*` stands for one host label or more in the host, and for anything in the path. */
    urls: string[];
    /** Selectors for sites on their own domain; any one of them is enough. */
    fingerprints?: string[];
  };
  questions?: QuestionLabel[];
  labels?: FixedLabel[];
  searchBoxes?: SearchBox[];
  prompts?: PromptBox[];
  editors?: EntryEditor[];
  /** Controls to leave out altogether. */
  skip?: string[];
  /** Showing while the page reads an upload. It may write over fields when it finishes. */
  uploadBusy?: string;
  /** For a page that sends no new file under the name of one it already holds, whatever is in it. */
  heldFile?: HeldFile;
  /** Returns a stable signature of the current wizard step (for SPA multi-step ATS forms). */
  stepSignature?: (doc: Document) => string | null;
  /** The page's own button to the next step. Its label is still checked: one that sends is never pressed. */
  nextButton?: string;
}
