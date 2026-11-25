// The shape of Feishu's mobile application form (/index/m/.../apply, the atsx- parts), classes as the page has
// them, and a stand-in for what the page does when tapped. On the phone a list opens in a drawer at the end of
// <body> with an rmc-picker wheel that turns only for touch drags (mouse drags do nothing), and a choice counts only
// on the drawer's 确定. Schools are a search box in a drawer whose option, once tapped, is the answer.

const row = (forId: string, title: string, control: string) =>
  `<div class="atsx-row atsx-form-item formItem__b8e45c custom-form-item"><div class="atsx-form-item-control"><span class="atsx-form-item-children"><div class="atsx-col atsx-form-item-label"><label for="${forId}" class="atsx-form-item-required" title="${title}">${title}</label></div></span></div><div class="atsx-col atsx-form-item-control-wrapper">${control}</div></div>`;

const input = (forId: string, title: string) =>
  row(forId, title, `<input id="${forId}" class="atsx-input atsx-input-lg" type="text" value="">`);

export const DEGREES = ['博士', 'MBA', '硕士', '本科', '大专', '高中', '专职', '初中', '小学', '其他'];

/** A list. `shown` is what an earlier answer left in it. */
export const mselect = (shown = '', options: string[] = DEGREES) =>
  `<div class="resumeSelect__34f4f7 resumeSelect"><div class="atsx-mselect resumeSelect-select" data-options="${options.join('|')}"><div class="atsx-mselect-content">${
    shown
      ? `<div class="atsx-mselect-mSelect-content" data-test="atsx-mselect-mSelect-content">${shown}</div>`
      : '<div class="atsx-mselect-text"><div class="atsx-mselect-placeholder">请选择</div></div>'
  }</div></div><div class="resumeSelect-icon"></div></div>`;

/** A span of months: `from` and `to` as YYYY-MM. */
export const mperiod = (from = '', to = '') =>
  `<div class="resumeDatePeriod__ee5f9a"><div class="atsx-mperiod"><div class="atsx-mperiod-content"><div class="atsx-mperiod-text">${
    from
      ? `<div class="atsx-mperiod-periodStr">${from}<span class="atsx-mperiod-periodDivider"> – </span>${to}</div>`
      : '<div class="atsx-mperiod-placeholder">请选择</div>'
  }</div></div></div><div class="resumeDatePeriod-icon"></div></div>`;

/** One month (出生日期), or one year (获奖时间: its drawer has no month wheel). `shown` as YYYY-MM or YYYY. */
export const mdate = (shown = '', onlyYear = false) =>
  `<div class="resumeDatePicker__352d1a"><div class="atsx-mdatepicker"${onlyYear ? ' data-only-year="1"' : ''}><div class="atsx-mdatepicker-content"><div class="atsx-mdatepicker-text">${
    shown ? `<div class="atsx-mdatepicker-value">${shown}</div>` : '<div class="atsx-mdatepicker-placeholder">请选择</div>'
  }</div></div></div><div class="resumeDatePicker-icon"></div></div>`;

/** A school: search box in a drawer. `known` is what the site's search knows. */
export const mschool = (shown = '', known: string[] = []) =>
  `<div class="atsx-m-input-select-warp" data-options="${known.join('|')}">${
    shown ? `<div class="atsx-m-input-select-hasValue">${shown}</div>` : '<div class="atsx-m-input-select-placeholder"><div class="placeholder-text">请输入</div></div>'
  }</div>`;

/** The places a job offers, one level deep as on the captured form. */
export const mcity = (places: string[] = ['北京', '杭州'], shown = '') =>
  `<div class="resumeSelect__13e0a4 resumeSelect"><div class="atsx-mSelectTreeInput" data-options="${places.join('|')}">${
    shown ? `<div>${shown}</div>` : '<div class="atsx-mSelectTree-text"><div class="atsx-mSelectTree-placeholder">请选择</div></div>'
  }</div><div class="resumeSelectIcon__13e0a4 resumeSelectIcon"></div></div>`;

export const mphone = () => `<div class="mobileText__0654e6 phoneNumber">+86 100-0000-0000</div>`;

export const educationCard = (n: number, schools: string[] = []) =>
  `<div class="resumeEditForm-item">` +
  row(`education[${n}].school`, '学校名称', mschool('', schools)) +
  row(`education[${n}].degree`, '学历', mselect()) +
  input(`education[${n}].field_of_study`, '专业') +
  row(`education[${n}].period`, '起止时间', mperiod()) +
  `</div>`;

export const FEISHU_MOBILE_FORM =
  `<form class="atsx-form">` +
  input('name', '姓名') +
  row('mobile', '手机号码', mphone()) +
  input('email', '邮箱') +
  row('city', '意向城市', mcity()) +
  `<div class="createFormSection"><div class="createFormSection-title">教育经历</div>${educationCard(0)}</div>` +
  `</form>`;

// ---- what the page does --------------------------------------------------------------------------------------------

/** Rows of one wheel, in CSS pixels. Only the indicator's style tells it to the page's own code in jsdom. */
const ROW = 34.56;

interface Wheel {
  el: HTMLElement;
  items: string[];
  index: number;
  set(i: number): void;
  /** New rows (a month wheel whose months depend on the year), keeping the row of the same words where there is one. */
  relist(items: string[]): void;
  /** Called each time a finger's turn has settled onto a row: what the page hears. */
  settled: (() => void)[];
}

function wheel(doc: Document, items: string[], index: number, extra = '', settleMs = 0): Wheel {
  const el = doc.createElement('div');
  el.className = `${extra} rmc-picker`.trim();
  const rows = (list: string[]) => list.map((t) => `<div class="rmc-picker-item">${t}</div>`).join('');
  el.innerHTML =
    `<div class="rmc-picker-mask" style="background-size: 100% ${ROW}px;"></div><div class="rmc-picker-indicator" style="top: ${ROW}px;"></div>` +
    `<div class="rmc-picker-content" style="padding: ${ROW}px 0px;">${rows(items)}</div>`;
  const w: Wheel = {
    el,
    items,
    index,
    settled: [],
    relist(next) {
      const words = w.items[w.index];
      w.items = next;
      el.querySelector('.rmc-picker-content')!.innerHTML = rows(next);
      w.set(Math.max(0, next.indexOf(words!)));
    },
    set(i) {
      w.index = Math.max(0, Math.min(w.items.length - 1, i));
      el.querySelectorAll('.rmc-picker-item').forEach((it, k) => it.classList.toggle('rmc-picker-item-selected', k === w.index));
      el.querySelector<HTMLElement>('.rmc-picker-content')!.style.transform = `translate3d(0px, ${-w.index * ROW}px, 0px)`;
    },
  };
  w.set(index);
  // Like rmc-picker: the finger's screenY on the way down and up; the wheel settles on the nearest row.
  let startY: number | null = null;
  let startIndex = 0;
  const y = (e: Event, list: 'touches' | 'changedTouches') => (e as unknown as Record<string, ArrayLike<{ screenY: number }>>)[list]?.[0]?.screenY;
  el.addEventListener('touchstart', (e) => {
    startY = y(e, 'touches') ?? null;
    startIndex = w.index;
  });
  el.addEventListener('touchend', (e) => {
    const end = y(e, 'changedTouches');
    if (startY === null || end === undefined) return;
    const rows = (startY - end) / ROW;
    startY = null;
    // Measured on the phone: let go exactly on a row and the wheel shows it, but the page never hears of it (the
    // value only changes when the wheel itself settles onto a row).
    if (Math.round(rows) !== 0 && Math.abs(rows - Math.round(rows)) < 0.05) {
      el.querySelector<HTMLElement>('.rmc-picker-content')!.style.transform = `translate3d(0px, ${-(startIndex + Math.round(rows)) * ROW}px, 0px)`;
      return;
    }
    // The wheel takes a moment to settle onto the row, and only then does the page hear of it.
    const settle = () => {
      w.set(startIndex + Math.round(rows));
      for (const heard of w.settled) heard();
    };
    if (settleMs > 0) setTimeout(settle, settleMs);
    else settle();
  });
  return w;
}

function drawer(doc: Document, kind: string, body: string): HTMLElement {
  const d = doc.createElement('div');
  d.tabIndex = -1;
  d.className = `atsx-drawer atsx-drawer-bottom atsx-drawer-open ${kind}`;
  d.innerHTML = `<div class="atsx-drawer-mask"></div><div class="atsx-drawer-content-wrapper" style="height: 256px;"><div class="atsx-drawer-content"><div class="atsx-drawer-wrapper-body"><div class="atsx-drawer-header-no-title"><button aria-label="Close" class="atsx-drawer-close"></button></div><div class="atsx-drawer-body">${body}</div></div></div></div>`;
  doc.body.appendChild(d);
  return d;
}

/** A drawer sliding in for `ms`, as `getAnimations` reports it; `done` once it is in. */
function slideIn(d: HTMLElement, ms: number, done: () => void): void {
  let running = true;
  const finished = new Promise<void>((resolve) =>
    setTimeout(() => {
      running = false;
      done();
      resolve();
    }, ms),
  );
  const animation = { get playState() { return running ? 'running' : 'finished'; }, finished };
  Object.defineProperty(d, 'getAnimations', { value: () => (running ? [animation] : []) });
}

/** Closed drawers stay in <body>, shut, as the page leaves them. */
const shut = (d: HTMLElement) => {
  d.classList.remove('atsx-drawer-open');
  d.querySelector<HTMLElement>('.atsx-drawer-content-wrapper')!.style.transform = 'translateY(100%)';
};

const YEARS = Array.from({ length: 237 }, (_, i) => String(1900 + i));
const MONTHS = Array.from({ length: 12 }, (_, i) => String(i + 1));

export interface MobilePage {
  /** Every drawer that was opened, in order. */
  opened: string[];
  stop(): void;
}

/**
 * Make the atsx widgets under `doc` behave. `now` is the month a fresh period wheel starts on. `slideMs`: as on the
 * live page, a span's drawer slides in for that long (an animation it reports), and what its wheels are turned to
 * before then goes unheard.
 */
export function behave(
  doc: Document,
  now: [number, number] = [2026, 11],
  opts: { slideMs?: number; settleMs?: number; monthsOf?: (year: number) => string[] } = {},
): MobilePage {
  const page: MobilePage = { opened: [], stop: () => doc.removeEventListener('click', onClick, true) };
  const onClick = (e: Event) => {
    const t = e.target as Element;
    // On the phone a tap on the outer .resumeSelect opens nothing: only the inner part listens.
    const list = t.closest('.atsx-mselect-content')?.closest<HTMLElement>('.atsx-mselect');
    if (list) return openList(list);
    const period = t.closest('.atsx-mperiod-content')?.closest<HTMLElement>('.atsx-mperiod');
    if (period) return openPeriod(period);
    const month = t.closest('.atsx-mdatepicker-content')?.closest<HTMLElement>('.atsx-mdatepicker');
    if (month) return openMonth(month);
    const school = t.closest<HTMLElement>('.atsx-m-input-select-warp');
    if (school) return openSchool(school);
    const tree = t.closest<HTMLElement>('.atsx-mSelectTreeInput');
    if (tree) return openTree(tree);
  };

  function openTree(root: HTMLElement) {
    page.opened.push('tree');
    const places = (root.dataset.options ?? '').split('|').filter(Boolean);
    const d = drawer(
      doc,
      '',
      `<div class="atsx-mSelectTreePopup-content"><div class="atsx-mSelectTreePopup-content-header">选择国家或地区</div><div class="atsx-mSelectTreePopup-content-treeArea">${places
        .map((p) => `<div class="atsx-mSelectTreePopup-content-single atsx-mSelectTreePopup-content-single-depth-0"><div class="atsx-mSelectTreePopup-content-singleLeft"><span>${p}</span><span></span></div></div>`)
        .join('')}</div></div>`,
    );
    // Measured: a tap on the option's outer row does nothing; its left part (the name) is what listens.
    d.querySelectorAll<HTMLElement>('.atsx-mSelectTreePopup-content-singleLeft').forEach((s) =>
      s.addEventListener('click', () => {
        // Chosen, the box holds the bare name: the placeholder block goes away.
        root.innerHTML = `<div>${s.textContent ?? ''}</div>`;
        shut(d);
      }),
    );
    d.querySelector('.atsx-drawer-close')!.addEventListener('click', () => shut(d));
  }
  doc.addEventListener('click', onClick, true);

  function openList(root: HTMLElement) {
    page.opened.push('list');
    const options = (root.dataset.options ?? '').split('|');
    const d = drawer(doc, 'atsx-mselect-popup', `<div class="atsx-mselect-popup-content"><div class="atsx-mselect-popup-header"><span class="atsx-mselect-popup-header-dismiss">取消</span><span class="atsx-mselect-popup-header-ok">确定</span></div><div class="atsx-mselect-popup-main"></div></div>`);
    const shown = root.querySelector('.atsx-mselect-mSelect-content')?.textContent ?? '';
    const w = wheel(doc, options, Math.max(0, options.indexOf(shown)));
    d.querySelector('.atsx-mselect-popup-main')!.appendChild(w.el);
    d.querySelector('.atsx-mselect-popup-header-ok')!.addEventListener('click', () => {
      root.querySelector('.atsx-mselect-content')!.innerHTML = `<div class="atsx-mselect-mSelect-content">${w.items[w.index]}</div>`;
      shut(d);
    });
    d.querySelector('.atsx-mselect-popup-header-dismiss')!.addEventListener('click', () => shut(d));
    d.querySelector('.atsx-drawer-close')!.addEventListener('click', () => shut(d));
  }

  function openPeriod(root: HTMLElement) {
    page.opened.push('period');
    const d = drawer(
      doc,
      'atsx-mperiod-popup',
      `<div class="atsx-mperiod-popup-content"><div class="atsx-mperiod-popup-header"><span class="atsx-mperiod-popup-header-dismiss atsx-mperiod-popup-header-operate">取消</span><span class="atsx-mperiod-popup-header-ok atsx-mperiod-popup-header-operate">确定</span></div><div class="atsx-mperiod-popup-main"><div><div class="rmc-multi-picker"></div></div></div><div class="atsx-mperiod-popup-footer"><div class="atsx-mperiod-popup-footer_wrapper"><div class="atsx-mperiod-popup-footer_wrapper__startTime footer_time_button footerTimeclicked">开始时间</div><div class="atsx-mperiod-popup-footer_wrapper__endTime footer_time_button">结束时间</div></div></div></div>`,
    );
    const ends: Record<'start' | 'end', [number, number]> = { start: [...now], end: [...now] };
    let side: 'start' | 'end' = 'start';
    const year = wheel(doc, YEARS, YEARS.indexOf(String(now[0])), 'atsx-mperiod-popup-year-picker', opts.settleMs);
    const month = wheel(doc, MONTHS, now[1] - 1, 'atsx-mperiod-popup-month-picker', opts.settleMs);
    // Some pages offer only the months of a year that may be chosen: the month wheel follows the year.
    if (opts.monthsOf) year.settled.push(() => month.relist(opts.monthsOf!(Number(year.items[year.index]))));
    d.querySelector('.rmc-multi-picker')!.append(year.el, month.el);
    // What the page heard each wheel settle on: a turn while the drawer is still sliding in is not heard.
    let heard = !opts.slideMs;
    if (opts.slideMs) slideIn(d, opts.slideMs, () => (heard = true));
    const heardAt = { year: year.index, month: month.index };
    year.settled.push(() => heard && (heardAt.year = year.index));
    month.settled.push(() => heard && (heardAt.month = month.index));
    const keep = () => (ends[side] = [Number(year.items[heardAt.year]), Number(month.items[heardAt.month])]);
    const show = () => {
      year.set(YEARS.indexOf(String(ends[side][0])));
      month.set(ends[side][1] - 1);
      heardAt.year = year.index;
      heardAt.month = month.index;
      d.querySelectorAll('.footer_time_button').forEach((b) => b.classList.toggle('footerTimeclicked', b.className.includes(side === 'start' ? '__startTime' : '__endTime')));
    };
    for (const s of ['start', 'end'] as const) {
      d.querySelector(`.atsx-mperiod-popup-footer_wrapper__${s}Time`)!.addEventListener('click', () => {
        keep();
        side = s;
        show();
      });
    }
    d.querySelector('.atsx-mperiod-popup-header-ok')!.addEventListener('click', () => {
      keep();
      const ym = ([y, m]: [number, number]) => `${y}-${String(m).padStart(2, '0')}`;
      root.querySelector('.atsx-mperiod-text')!.innerHTML = `<div class="atsx-mperiod-periodStr">${ym(ends.start)}<span class="atsx-mperiod-periodDivider"> – </span>${ym(ends.end)}</div>`;
      shut(d);
    });
    d.querySelector('.atsx-mperiod-popup-header-dismiss')!.addEventListener('click', () => shut(d));
  }

  function openMonth(root: HTMLElement) {
    page.opened.push('month');
    const d = drawer(
      doc,
      'atsx-mdatepicker-popup',
      `<div class="atsx-mdatepicker-popup-content"><div class="atsx-mdatepicker-popup-header"><span class="atsx-mdatepicker-popup-header-dismiss atsx-mdatepicker-popup-header-operate">取消</span><span class="atsx-mdatepicker-popup-header-ok atsx-mdatepicker-popup-header-operate">确定</span></div><div class="atsx-mdatepicker-popup-main"><div class="rmc-multi-picker"></div></div></div>`,
    );
    const onlyYear = root.dataset.onlyYear === '1';
    const year = wheel(doc, YEARS, YEARS.indexOf(String(now[0])), `atsx-mdatepicker-popup-year-picker showYearCaption${onlyYear ? ' onlyYear' : ''}`);
    const month = wheel(doc, MONTHS, now[1] - 1, 'atsx-mdatepicker-popup-month-picker centerMonth');
    d.querySelector('.rmc-multi-picker')!.append(...(onlyYear ? [year.el] : [year.el, month.el]));
    d.querySelector('.atsx-mdatepicker-popup-header-ok')!.addEventListener('click', () => {
      const shown = onlyYear ? year.items[year.index] : `${year.items[year.index]}-${month.items[month.index]!.padStart(2, '0')}`;
      root.querySelector('.atsx-mdatepicker-text')!.innerHTML = `<div class="atsx-mdatepicker-value">${shown}</div>`;
      shut(d);
    });
    d.querySelector('.atsx-mdatepicker-popup-header-dismiss')!.addEventListener('click', () => shut(d));
    d.querySelector('.atsx-drawer-close')!.addEventListener('click', () => shut(d));
  }

  function openSchool(root: HTMLElement) {
    page.opened.push('school');
    const known = (root.dataset.options ?? '').split('|').filter(Boolean);
    const d = drawer(
      doc,
      'atsx-m-input-select-popup',
      `<div class="atsx-m-input-select-content"><input class="atsx-input atsx-m-input-select-input" value=""><div class="atsx-m-input-select-options-warp"></div></div>`,
    );
    d.querySelector('.atsx-drawer-wrapper-body')!.insertAdjacentHTML(
      'afterbegin',
      `<div class="atsx-drawer-header"><div class="atsx-drawer-title"><span class="atsx-m-input-select-header-dismiss">取消</span><div class="atsx-m-input-select-title"><span>学校</span></div><span class="atsx-m-input-select-header-ok">确定</span></div></div>`,
    );
    const box = d.querySelector<HTMLInputElement>('input')!;
    const warp = d.querySelector('.atsx-m-input-select-options-warp')!;
    const take = (text: string) => {
      root.innerHTML = `<div class="atsx-m-input-select-hasValue">${text}</div>`;
      shut(d);
    };
    box.addEventListener('input', () => {
      const q = box.value.trim();
      warp.innerHTML = q
        ? known
            .filter((k) => k.includes(q))
            .map((k) => `<div class="atsx-m-input-select-option"><span><span>${k}</span></span></div>`)
            .join('')
        : '';
      warp.querySelectorAll<HTMLElement>('.atsx-m-input-select-option').forEach((o) => o.addEventListener('click', () => take(o.textContent ?? '')));
    });
    d.querySelector('.atsx-m-input-select-header-ok')!.addEventListener('click', () => (box.value.trim() ? take(box.value.trim()) : shut(d)));
    d.querySelector('.atsx-m-input-select-header-dismiss')!.addEventListener('click', () => shut(d));
  }

  return page;
}
