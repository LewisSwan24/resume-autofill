// What a site can tell the general engine, as data. Every entry here comes from a real page that the
// engine could not read by itself; a site the engine already reads needs no adapter.

/** A question whose text sits outside any label: the text becomes the label of its control. */
export interface QuestionLabel {
  /** Controls this applies to. */
  control: string;
  /** The box around one question and its control. */
  within: string;
  /** Inside `within`: the element holding the question. */
  text: string;
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

export interface AtsAdapter {
  id: string;
  match: {
    /** `*` stands for one host label or more in the host, and for anything in the path. */
    urls: string[];
    /** Selectors for sites on their own domain; any one of them is enough. */
    fingerprints?: string[];
  };
  questions?: QuestionLabel[];
  searchBoxes?: SearchBox[];
  /** Showing while the page reads an upload. It may write over fields when it finishes. */
  uploadBusy?: string;
}
