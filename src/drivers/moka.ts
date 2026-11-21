// Moka's own widgets. Plain text inputs that only look like boxes: the answer is what gets picked from the panel
// they open at the end of <body>, and the input itself stays empty. Class names carry a build hash, so every
// selector goes by the part before it.
import type { Control } from '../engine/types';
import { closeDropdown, findDropdownNear, shutDropdown, visibleOptions } from './dropdown';
import { fireInput, focusElement, setNativeValue, simulateClick, typeText } from './events';
import type { DatePart, Driver, DriverContext, FillIntent, FillResult, OptionMatch } from './types';
import { waitFor } from './wait';

const PANEL = '[class*="sd-Dropdown-dropdown"]';
const OPTION = '[class*="sd-Menu-container"]';
const SHOWN = '[class*="sd-Input-display-value"]';
const PICKER = 'label[class*="sd-Select-container"]';
const YEAR_SHOWN = '[class*="sd-basic-selector-year"]';
const MONTH_CELL = '[class*="sd-basic-year-item"]';
const REGION_TAG = '[class*="sd-Tag-text"]';

/** A panel that only opens once something is typed: 学校名称 and 专业名称 search as you go. */
const OPENS_BY_ITSELF_MS = 500;
const SEARCH_MS = 3000;
const MONTHS_ZH = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
/** Far enough for any birth date from where the panel starts. */
const MAX_YEAR_STEPS = 150;

const failed = (detail: string, observed: string | null, outcome: FillResult['outcome'] = 'action_failed'): FillResult => ({ ok: false, observed, outcome, detail });
const clean = (raw: string | null | undefined): string => (raw ?? '').replace(/\s+/g, ' ').trim();
const inputOf = (el: Element): HTMLInputElement | null => (el.matches('input') ? (el as HTMLInputElement) : el.querySelector('input'));
const shownIn = (el: Element): string => clean(el.querySelector(SHOWN)?.textContent);

async function openPanel(owner: HTMLElement, ctx: DriverContext, timeout: number): Promise<HTMLElement | null> {
  const input = inputOf(owner) ?? owner;
  focusElement(input);
  simulateClick(input);
  return waitFor(() => findDropdownNear(owner, PANEL, { doc: ctx.doc }), { timeout, signal: ctx.signal, root: ctx.doc });
}

/** What the options look like to a matcher, and clicking the one it chose. */
async function pickFrom(panel: HTMLElement, match: (labels: { label: string }[]) => OptionMatch): Promise<{ picked: string } | OptionMatch> {
  const options = visibleOptions(panel, OPTION);
  const m = match(options.map((o) => o.info));
  if (m.status !== 'matched') return m;
  const chosen = options[m.index]!;
  simulateClick(chosen.el.querySelector('[class*="sd-Menu-content"]') ?? chosen.el);
  return { picked: chosen.info.label };
}

async function settled(probe: () => boolean, ctx: DriverContext): Promise<boolean> {
  return (await waitFor(() => probe() || null, { timeout: 1500, signal: ctx.signal, root: ctx.doc })) === true;
}

async function fillSelect(control: Control, intent: FillIntent, ctx: DriverContext): Promise<FillResult> {
  if (intent.kind !== 'choice') return failed(`a ${intent.kind} answer on a single list`, shownIn(control.el));
  const input = inputOf(control.el);
  let panel = await openPanel(control.el, ctx, OPENS_BY_ITSELF_MS);
  let typed = false;
  if (!panel || visibleOptions(panel, OPTION).length === 0) {
    if (!input || input.readOnly) return failed('the list did not open', shownIn(control.el));
    typeText(input, intent.query);
    typed = true;
    panel = await waitFor(
      () => {
        const open = findDropdownNear(control.el, PANEL, { doc: ctx.doc });
        return open && visibleOptions(open, OPTION).length > 0 ? open : null;
      },
      { timeout: SEARCH_MS, signal: ctx.signal, root: ctx.doc },
    );
  }
  const leaveNothingBehind = () => {
    if (typed && input) {
      setNativeValue(input, '');
      fireInput(input, null, 'deleteContentBackward');
    }
    shutDropdown(ctx.doc, () => findDropdownNear(control.el, PANEL, { doc: ctx.doc }) !== null);
  };
  if (!panel) {
    leaveNothingBehind();
    return failed(`nothing on the list for ${intent.query}`, shownIn(control.el), 'no_option');
  }
  const result = await pickFrom(panel, intent.match);
  if (!('picked' in result)) {
    leaveNothingBehind();
    return result.status === 'ambiguous'
      ? failed('several options fit', shownIn(control.el), 'needs_review')
      : failed(`nothing on the list for ${intent.query}`, shownIn(control.el), 'no_option');
  }
  const taken = await settled(() => shownIn(control.el) === result.picked, ctx);
  closeDropdown(ctx.doc);
  return taken ? { ok: true, observed: result.picked } : failed('the list did not take the choice', shownIn(control.el));
}

// ---- a list that takes several ----------------------------------------------------------------------------------

const TAGS = '[class*="sd-Input-tag-container"]';
const isMulti = (control: Control): boolean => control.el.querySelector(TAGS) !== null;
const tagsIn = (control: Control): string[] => Array.from(control.el.querySelectorAll(REGION_TAG)).map((t) => clean(t.textContent));
const readTags = (control: Control): string | null => tagsIn(control).join('、') || null;

/**
 * Each answer on the list gets a tick, one already there stays, and anything else is left as it is. When some answers
 * are not on the list, the ticks made stay and the applicant is asked to look, told which answers were not there.
 */
async function fillMulti(control: Control, intent: FillIntent, ctx: DriverContext): Promise<FillResult> {
  if (intent.kind !== 'multi') return failed(`a ${intent.kind} answer on a list that takes several`, readTags(control));
  const panel = await openPanel(control.el, ctx, 1500);
  if (!panel) return failed('the list did not open', readTags(control));
  try {
    const labels = visibleOptions(panel, OPTION).map((o) => o.info);
    const wanted: string[] = [];
    const notThere: string[] = [];
    let unsure = false;
    for (const item of intent.items) {
      const m = item.match(labels);
      if (m.status === 'matched') {
        if (!wanted.includes(labels[m.index]!.label)) wanted.push(labels[m.index]!.label);
      } else notThere.push(item.query);
      if (m.status === 'ambiguous') unsure = true;
    }
    if (wanted.length === 0) return failed('nothing on the list fits', readTags(control), unsure ? 'needs_review' : 'no_option');
    for (const name of wanted) {
      if (tagsIn(control).includes(name)) continue;
      // Picking draws the list again, so the row is found afresh each time.
      const row = visibleOptions(panel, OPTION).find((o) => o.info.label === name);
      if (!row) return failed(`${name} went from the list`, readTags(control));
      simulateClick(row.el.querySelector('[class*="sd-Menu-content"]') ?? row.el);
      if (!(await settled(() => tagsIn(control).includes(name), ctx))) return failed(`the list did not take ${name}`, readTags(control));
    }
    if (notThere.length > 0) return failed(`not on the list: ${notThere.join('、')}`, readTags(control), 'needs_review');
    return { ok: true, observed: readTags(control) };
  } finally {
    shutDropdown(ctx.doc, () => findDropdownNear(control.el, PANEL, { doc: ctx.doc }) !== null);
  }
}

// ---- a date as two lists, year then month ------------------------------------------------------------------

const asYear = (year: number) => (label: string) => clean(label).replace(/年$/, '') === String(year);
const asMonth = (month: number) => (label: string) => {
  const text = clean(label).replace(/月$/, '');
  return text === String(month) || text === String(month).padStart(2, '0') || `${text}月` === MONTHS_ZH[month - 1];
};

async function fillPart(picker: HTMLElement, fits: (label: string) => boolean, ctx: DriverContext): Promise<boolean> {
  const panel = await openPanel(picker, ctx, 1500);
  if (!panel) return false;
  const result = await pickFrom(panel, (options) => {
    const hits = options.flatMap((o, index) => (fits(o.label) ? [index] : []));
    return hits.length === 1 ? { status: 'matched', index: hits[0]!, confidence: 1 } : { status: 'none' };
  });
  if (!('picked' in result)) {
    shutDropdown(ctx.doc, () => findDropdownNear(picker, PANEL, { doc: ctx.doc }) !== null);
    return false;
  }
  const taken = await settled(() => shownIn(picker) === result.picked, ctx);
  closeDropdown(ctx.doc);
  return taken;
}

/** The 至今 box beside a span: ticked, it takes the end's two lists off the page. */
const stillBox = (control: Control): HTMLInputElement | null => control.el.querySelector<HTMLInputElement>('input[type=checkbox]');

const readParts = (control: Control): string | null => {
  const shown = Array.from(control.el.querySelectorAll(PICKER)).map(shownIn);
  if (shown.every((s) => !s)) return null;
  const date = (y = '', m = '') => (y && m ? `${y}-${m.padStart(2, '0')}` : y || m);
  const [a, b, c, d] = shown;
  if (shown.length === 2 && stillBox(control)?.checked) return `${date(a, b)} ~ 至今`;
  return shown.length === 4 ? `${date(a, b)} ~ ${date(c, d)}` : date(a, b);
};

async function setStill(control: Control, on: boolean, ctx: DriverContext): Promise<boolean> {
  const box = stillBox(control);
  if (!box) return false;
  if (box.checked !== on) simulateClick(box);
  const lists = on ? 2 : 4;
  return settled(() => box.checked === on && control.el.querySelectorAll(PICKER).length === lists, ctx);
}

async function fillParts(control: Control, intent: FillIntent, ctx: DriverContext): Promise<FillResult> {
  // Still going on a span with no 至今: a start alone would leave half an answer, so nothing is written.
  if (intent.kind === 'dateFrom' && !stillBox(control)) return failed('still going, and the form has no word for that', readParts(control), 'needs_review');
  // A span still going ticks 至今; one that ended needs it off, or there is nowhere for the end to go.
  if (intent.kind === 'dateFrom' ||(intent.kind === 'dateRange' && stillBox(control)?.checked)) {
    if (!(await setStill(control, intent.kind === 'dateFrom', ctx))) return failed('the 至今 box would not change', readParts(control));
  }
  const pickers = Array.from(control.el.querySelectorAll<HTMLElement>(PICKER));
  const dates: DatePart[] | null =
    (intent.kind === 'date' || intent.kind === 'dateFrom') && pickers.length === 2
      ? [intent.kind === 'date' ? intent : intent.start]
      : intent.kind === 'dateRange' && pickers.length === 4
        ? [intent.start, intent.end]
        : null;
  if (!dates) return failed(`a ${intent.kind} answer on ${pickers.length} lists`, readParts(control));
  for (const [i, date] of dates.entries()) {
    if (!(await fillPart(pickers[i * 2]!, asYear(date.year), ctx))) return failed(`no year ${date.year} on the list`, readParts(control));
    if (!(await fillPart(pickers[i * 2 + 1]!, asMonth(date.month), ctx))) return failed(`no month ${date.month} on the list`, readParts(control));
  }
  return { ok: true, observed: readParts(control) };
}

// ---- a date as a panel of months -------------------------------------------------------------------------------

const shownYear = (panel: Element): number | null => {
  const m = /(\d{4})/.exec(panel.querySelector(YEAR_SHOWN)?.textContent ?? '');
  return m ? Number(m[1]) : null;
};

async function fillMonthPanel(control: Control, intent: FillIntent, ctx: DriverContext): Promise<FillResult> {
  const input = inputOf(control.el);
  const read = () => clean(input?.value) || null;
  if (intent.kind !== 'date') return failed(`a ${intent.kind} answer on one date`, read());
  const panel = await openPanel(control.el, ctx, 1500);
  if (!panel) return failed('the date panel did not open', read());
  try {
    for (let step = 0; step < MAX_YEAR_STEPS; step++) {
      const year = shownYear(panel);
      if (year === null) return failed('the panel shows no year', read());
      if (year === intent.year) break;
      const arrow = panel.querySelector(year < intent.year ? '[class*="icondoubleRight"]' : '[class*="icondoubleLeft"]');
      if (!arrow) return failed('the panel has no way to the year', read());
      simulateClick(arrow);
      const moved = await waitFor(() => shownYear(panel) !== year || null, { timeout: 800, signal: ctx.signal, root: ctx.doc });
      if (!moved) return failed('the panel would not change year', read());
    }
    if (shownYear(panel) !== intent.year) return failed(`could not reach ${intent.year}`, read());
    const cell = Array.from(panel.querySelectorAll(MONTH_CELL)).find((c) => clean(c.textContent) === MONTHS_ZH[intent.month - 1]);
    if (!cell) return failed('the panel shows no month to pick', read());
    simulateClick(cell);
    const wanted = new RegExp(`${intent.year}\\D*0?${intent.month}(?!\\d)`);
    const taken = await settled(() => wanted.test(read() ?? ''), ctx);
    return taken ? { ok: true, observed: read() } : failed('the panel did not take the month', read());
  } finally {
    shutDropdown(ctx.doc, () => findDropdownNear(control.el, PANEL, { doc: ctx.doc }) !== null);
  }
}

// ---- places, a level at a time --------------------------------------------------------------------------------

/** 浙江省 on the resume is 浙江 on the panel, 中国香港 is 香港, and 阿克苏地区 may be written 阿克苏. */
const placeName = (raw: string): string =>
  clean(raw)
    .replace(/^中国/, '')
    .replace(/(?:壮族|回族|维吾尔)?自治区$|特别行政区$|省$|市$|地区$|盟$/, '');

/** Moka keeps a place that was merged or renamed on its list, with （旧） after the name. */
const RETIRED = /\s*[（(]旧[）)]$/;

/**
 * How a word on the panel fits a level of the resume, closest first: the same name; the same name, retired; the
 * same place written short (武侯 for 武侯区, 凉山州 or 凉山 for 凉山彝族自治州). Null when it does not fit.
 */
function fitOf(tagText: string, name: string): number | null {
  const want = placeName(name);
  const tag = placeName(tagText);
  if (tag === want) return 0;
  const current = placeName(tagText.replace(RETIRED, ''));
  if (current !== tag && current === want) return 1;
  if (current.replace(/[区县]$/, '') === want) return 2;
  // An autonomous prefecture or county, and the short name people write for it.
  if (/自治[州县旗]$/.test(current)) {
    const stem = want.replace(/[州县旗]$/, '');
    if (stem.length >= 2 && current.startsWith(stem)) return 2;
  }
  return null;
}

function regionTag(panel: Element, name: string): Element | null {
  const tags = Array.from(panel.querySelectorAll(REGION_TAG));
  for (const rank of [0, 1, 2]) {
    const hits = tags.filter((t) => fitOf(t.textContent ?? '', name) === rank);
    // The cities everyone picks are listed first, above the province they sit in: the list proper comes last.
    if (rank === 0 && hits.length > 0) return hits[hits.length - 1]!;
    // A looser fit counts only when nothing else on the panel fits as well.
    if (hits.length === 1) return hits[0]!;
    if (hits.length > 1) return null;
  }
  return null;
}

const readPlace = (control: Control): string | null => clean(control.el.textContent) || clean(inputOf(control.el)?.value) || null;
const levelsOf = (shown: string | null): string[] => (shown ?? '').split(/[\s/／,，、>＞-]+/).filter(Boolean);

/** The box against the resume's levels: the same place, as deep or deeper; the start of it; or another place. */
function compareShown(shown: string[], path: string[]): 'covers' | 'wider' | 'other' {
  const n = Math.min(shown.length, path.length);
  for (let i = 0; i < n; i++) if (fitOf(shown[i]!, path[i]!) === null) return 'other';
  return shown.length >= path.length ? 'covers' : 'wider';
}

async function fillPlace(control: Control, intent: FillIntent, ctx: DriverContext): Promise<FillResult> {
  if (intent.kind !== 'cascade') return failed(`a ${intent.kind} answer on a place`, readPlace(control));
  // A place the page or the applicant put there first: the same place, perhaps down to its district, stays as it
  // is; another place is kept and left to check. Only one that stops short of the resume is taken further.
  const before = readPlace(control);
  if (before) {
    const was = compareShown(levelsOf(before), intent.path);
    if (was === 'covers') return { ok: true, observed: before };
    if (was === 'other') return failed('another place is already there', before, 'needs_review');
  }
  const panel = await openPanel(control.el, ctx, 1500);
  if (!panel) return failed('the place panel did not open', readPlace(control));
  try {
    let previous: Element | null = null;
    const picked: string[] = [];
    for (const name of intent.path) {
      const stale: Element | null = previous;
      const tag: Element | null = await waitFor<Element>(
        () => {
          const t = regionTag(panel, name);
          return t && t !== stale ? t : null;
        },
        { timeout: 1500, signal: ctx.signal, root: ctx.doc },
      );
      // The levels above it are already in the box, so what is there is true but short of the answer.
      if (!tag) return failed(`no ${name} on the panel`, readPlace(control), previous ? 'needs_review' : 'no_option');
      picked.push(clean(tag.textContent));
      simulateClick(tag);
      previous = tag;
    }
    const confirm = panel.querySelector('[class*="confirm-"] button');
    if (confirm) simulateClick(confirm);
    // Every level, in order: a box that ends right but lost a level above is not the resume's place.
    const sameAsPicked = () => {
      const shown = levelsOf(readPlace(control));
      return shown.length === picked.length && picked.every((p, i) => levelsOf(p).join('') === shown[i] || fitOf(shown[i]!, p) === 0);
    };
    const taken = await settled(sameAsPicked, ctx);
    return taken ? { ok: true, observed: readPlace(control) } : failed('the box does not show every level picked', readPlace(control));
  } finally {
    shutDropdown(ctx.doc, () => findDropdownNear(control.el, PANEL, { doc: ctx.doc }) !== null);
  }
}

// ---- the drivers ------------------------------------------------------------------------------------------------

const guarded = async (run: () => Promise<FillResult>, read: () => string | null): Promise<FillResult> => {
  try {
    return await run();
  } catch (error) {
    return failed(error instanceof Error ? error.message : String(error), read());
  }
};

const isPair = (c: Control) => c.el.matches('.month-range-select');

export const mokaDrivers: Driver[] = [
  {
    id: 'moka-select',
    lib: 'moka',
    kinds: ['select'],
    match: () => true,
    fill: (c, i, ctx) => (isMulti(c) ? guarded(() => fillMulti(c, i, ctx), () => readTags(c)) : guarded(() => fillSelect(c, i, ctx), () => shownIn(c.el))),
    read: (c) => (isMulti(c) ? readTags(c) : shownIn(c.el) || null),
  },
  {
    id: 'moka-date',
    lib: 'moka',
    kinds: ['date'],
    match: () => true,
    fill: (c, i, ctx) => guarded(() => (isPair(c) ? fillParts(c, i, ctx) : fillMonthPanel(c, i, ctx)), () => (isPair(c) ? readParts(c) : clean(inputOf(c.el)?.value) || null)),
    read: (c) => (isPair(c) ? readParts(c) : clean(inputOf(c.el)?.value) || null),
  },
  {
    id: 'moka-place',
    lib: 'moka',
    kinds: ['cascader'],
    match: () => true,
    fill: (c, i, ctx) => guarded(() => fillPlace(c, i, ctx), () => readPlace(c)),
    read: readPlace,
  },
];
