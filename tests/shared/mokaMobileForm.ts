// The shape of Moka's phone application form (/m/..., a step form), classes as the page has them (the hashes here
// are made up), and a stand-in for what the page does when tapped. Seen in a replay of a phone capture, Nov 2026:
// - a list is a readonly 「请选择」 input; a tap opens a sheet inside the field with 取消, 清除 and 确认 on top. A tap
//   on a row only marks it (several on a multi list); the input takes the marked rows, joined by '，', on 确认.
// - a date is a box with no input; a tap opens wheels inside it: a column per part (year, month), each a list whose
//   `top` the page moves with the finger, 30px a row. The columns listen for touches only, from half a second after
//   the panel opens (a loading cover hides them until then), and the value follows the finger as it moves. 确定 writes
//   YYYY-MM into the box, with the age after it for a birth date. Only the part of the box showing the value
//   listens to a tap.

/** A row the page moves its wheels by, in CSS pixels. */
export const ROW = 30;
/** How long the page keeps its wheels covered after they open. */
export const COVER_MS = 60;

const field = (title: string, body: string, required = true) =>
  `<div class="applyField-Fk3Ab9xQ1z "><div class="title-info-Qa8Zr2Lm0p"><span class="title-Zx81Kd0Qwe"><span>${title}</span></span>${
    required ? '<span class="sd-Icon-container-1abcd sd-Icon-iconrequired-2bcde required-Rq7Wm2Hd0s"></span>' : ''
  }</div>${body}<div class="describe-Dz2Lq8Nn4c"></div></div>`;

export type ListKind = 'select' | 'select_info' | 'bool_info' | 'multi_select_info';

/** A list. `shown` is what an earlier answer left in its input. */
export const mlist = (title: string, options: string[], kind: ListKind = 'select', shown = '') =>
  field(
    title,
    `<div class="${kind}" data-options="${options.join('|')}"><input class="" placeholder="请选择" readonly="" value="${shown}"><div class="fade-gradient"></div><span class="clean-value display-no-border"></span><span class="sd-Icon-container-1abcd sd-Icon-iconright-3cdef"></span></div>`,
  );

export const mtext = (title: string, placeholder = '请输入') =>
  field(title, `<div class="string_info"><input class="" placeholder="${placeholder}"></div>`, false);

const dateBox = (label: string, shown: string, extra = '') =>
  `<div class="mobile-text-input${extra}"><div class="mobile-text-input__wrapper"><span class="mobile-text-input__label">${label}</span><span class="mobile-text-input__input">${shown}</span><span class="clean-value display-no-border"></span></div></div>`;

/** One month, as a birth date is asked. */
export const mmonth = (title: string, shown = '') => field(title, `<div class="old-style-hack">${dateBox(title, shown)}</div>`);

/** A start and an end month, each its own box. */
export const mspan = (title: string, from = '', to = '') =>
  field(title, `<div class="old-style-hack">${dateBox('开始时间', from, ' date_info_select')}${dateBox('结束时间', to, ' date_info_select end-date')}</div>`);

const step = (n: number, of: number, title: string, body: string, shown: boolean) =>
  `<div style="display: ${shown ? 'block' : 'none'};"><div class="block-Bk2Lw9Qz0x"><div class="count-Cn4Tq7Vb2m">Step: ${n}/${of}</div><div class="title-Zx81Kd0Qwe fix-title-Fx0Ld3Kq8w"><span>${title}</span></div><div class="field-block-Fb6Hs1Jd4k"><div class="applyFields-Af3Gm7Pq2r">${body}</div></div></div></div>`;

export const LEVELS = ['本科', '硕士', '博士', '高中', '大专', '中专', '初中及以下', 'MBA', '其他'];
export const YES_NO = ['是', '否'];
export const LANGUAGES = ['英语', '日语', '韩语', '德语', '法语', '其他'];
export const CITIES = ['深圳', '上海', '成都', '杭州'];

/** A whole phone form of three steps, the way the real one is laid out. */
export const MOKA_MOBILE_FORM =
  `<div class="mobile"><div class="apply-mobile-Am3Kd8Wq1z"><div class="mobile-layout__content content-Ct5Ls2Nx9q has-header">` +
  step(1, 3, '个人信息', mtext('姓名', '请输入你的姓名') + mlist('性别', ['男', '女']) + mmonth('出生日期 (年龄)') + mlist('最高学历', LEVELS), true) +
  step(2, 3, '求职意向', mlist('是否接收组织调配', YES_NO, 'bool_info') + mlist('期望城市', CITIES, 'multi_select_info'), false) +
  step(3, 3, '教育背景', mlist('学历', LEVELS) + mspan('就读时间'), false) +
  `</div><div class="mobile-layout__footer"><button type="button" class="sd-Button-container-1qwer">下一步</button></div></div></div>`;

// ---- what the page does --------------------------------------------------------------------------------------------

export interface MobilePage {
  /** What was opened, in order: 'list' or 'date'. */
  opened: string[];
  /** Taps that landed on a row, in order. */
  tapped: string[];
  stop(): void;
}

function list(doc: Document, root: HTMLElement, page: MobilePage) {
  if (root.querySelector('[class*="mobile-dialog-"]')) return;
  page.opened.push('list');
  const input = root.querySelector('input')!;
  const options = (root.dataset.options ?? '').split('|');
  const multi = root.classList.contains('multi_select_info');
  const marked = new Set(input.value ? input.value.split('，') : []);
  const dialog = doc.createElement('div');
  dialog.className = 'mobile-dialog-Md3Kq8Zp1x drop-down-Dd4Lw2Nm7c';
  dialog.innerHTML =
    `<div class="rounded-top-bar-Rt5Hs1Kd9q standard-select-top-bar-St6Qa3Wv2b"><div class="start-Sx7Ld0Fq4m selectGray-Gy8Pz1Kc3n">取消</div><div class="end-Ex9Mw4Hb6t selectBlue-Bu0Nq5Ls8r">清除</div><div class="end-Ex9Mw4Hb6t selectBlue-Bu0Nq5Ls8r">确认</div></div>` +
    `<div class="list-Lz1Kp6Rd3w"><div class="dialog-list-view-Dv2Hq7Tm4s standard-list-view-Sv3Jw8Yn5u ">${options
      .map((o) => `<div class="list-view-item-Li4Kx9Zo6v "><div class="standard-list-item-Si5Ly0Ap7w standard-normal-list-item-Sn6Mz1Bq8x"><div></div><span class="content-Ct7Na2Cr9y">${o}</span><span class="sd-Icon-container-1abcd sd-Icon-iconchecked-4defg icon-Ic8Ob3Ds0z"></span></div></div>`)
      .join('')}</div></div><div class="dialog-mask-Mk9Pc4Et1a drop-down-mask-Dm0Qd5Fu2b"></div>`;
  const rows = Array.from(dialog.querySelectorAll<HTMLElement>('[class*="list-view-item-"]'));
  const paint = () =>
    rows.forEach((r) => {
      const on = marked.has(r.textContent!.trim());
      r.classList.toggle('list-item-selected-Ls1Re6Gv3c', on);
      r.firstElementChild!.className = `standard-list-item-Si5Ly0Ap7w ${on ? 'standard-list-item-selected-Sl2Sf7Hw4d' : 'standard-normal-list-item-Sn6Mz1Bq8x'}`;
    });
  paint();
  rows.forEach((r) =>
    r.addEventListener('click', () => {
      const label = r.textContent!.trim();
      page.tapped.push(label);
      if (marked.has(label)) marked.delete(label);
      else {
        if (!multi) marked.clear();
        marked.add(label);
      }
      paint();
    }),
  );
  const [cancel, clear, ok] = Array.from(dialog.querySelectorAll<HTMLElement>('.rounded-top-bar-Rt5Hs1Kd9q > div'));
  cancel!.addEventListener('click', () => dialog.remove());
  clear!.addEventListener('click', () => {
    marked.clear();
    paint();
  });
  ok!.addEventListener('click', () => {
    // In the order the list has them, as the page writes them.
    input.value = options.filter((o) => marked.has(o)).join('，');
    dialog.remove();
  });
  root.appendChild(dialog);
}

const YEARS = Array.from({ length: 100 }, (_, i) => 1932 + i);
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

function wheels(doc: Document, box: HTMLElement, page: MobilePage, now: [number, number], age: boolean) {
  const wrapper = box.querySelector<HTMLElement>('.mobile-text-input__wrapper')!;
  if (wrapper.querySelector('[class*="selector-panel-"]')) return;
  page.opened.push('date');
  const shownEl = wrapper.querySelector('.mobile-text-input__input')!;
  const was = /(\d{4})-(\d{2})/.exec(shownEl.textContent ?? '');
  const value: [number, number] = was ? [Number(was[1]), Number(was[2])] : [...now];
  const columns = [YEARS, MONTHS];
  const index = [YEARS.indexOf(value[0]), value[1] - 1];
  const top = 130;
  const panel = doc.createElement('div');
  panel.className = 'container-Cn1Wd6Lx3e day-info__input-Di2Xe7My4f';
  panel.innerHTML =
    `<div class="body-container"><div class="selector-panel-Sp3Yf8Nz5g native-panel-class"><div class="loading-cover-Lc4Zg9Oa6h"><div class="sd-Loading-loading-1abcd"></div></div>` +
    `<div class="panel-header-Ph5Ah0Pb7i"><span class="selector-btn-Sb6Bi1Qc8j btn-cancel-Bc7Cj2Rd9k">取消</span><span class="title-Tt8Dk3Se0l">${shownEl.previousElementSibling?.textContent ?? ''}</span><span class="selector-btn-Sb6Bi1Qc8j btn-confirm-Bf9El4Tf1m">确定</span></div>` +
    `<div class="panel-body-Pb0Fm5Ug2n"><div class="select-box-Sx1Gn6Vh3o" style="top: ${top}px;"></div>${columns
      .map(
        (items, c) =>
          `<div class="column-Co2Ho7Wi4p" data-column="${c}"><ul class="column-list-Cl3Ip8Xj5q" data-list="${c}">${items
            .map((v, i) => `<li class="item-It4Jq9Yk6r item-normal-In5Kr0Zl7s" data-index="${i}" data-active="false" data-value="${v}">${v}</li>`)
            .join('')}</ul></div>`,
      )
      .join('')}</div></div></div>`;
  const lists = Array.from(panel.querySelectorAll<HTMLElement>('[data-list]'));
  const paint = () =>
    lists.forEach((ul, c) => {
      ul.style.top = `${top - index[c]! * ROW}px`;
      ul.querySelectorAll('li').forEach((li, i) => {
        li.dataset.active = String(i === index[c]);
        li.className = `item-It4Jq9Yk6r ${i === index[c] ? 'item-active-Ia6Ls1Am8t' : 'item-normal-In5Kr0Zl7s'}`;
      });
    });
  paint();
  // The page's own touch code: the list follows the finger, and the row under the band is the value at once.
  const listen = () => {
    panel.querySelector<HTMLElement>('[class*="loading-cover-"]')!.style.display = 'none';
    panel.querySelectorAll<HTMLElement>('[data-column]').forEach((col) => {
      const c = Number(col.dataset.column);
      const ul = lists[c]!;
      const count = columns[c]!.length;
      const min = top - (count - 1) * ROW;
      let startY = 0;
      let startTop = 0;
      col.addEventListener('touchstart', (e) => {
        startY = (e as TouchEvent).touches[0]!.clientY;
        startTop = parseInt(ul.style.top, 10);
      });
      col.addEventListener('touchmove', (e) => {
        let n = startTop + ((e as TouchEvent).touches[0]!.clientY - startY);
        n = Math.max(min, Math.min(top, n));
        ul.style.top = `${n}px`;
        index[c] = count - Math.round((n - min) / ROW) - 1;
      });
      col.addEventListener('touchend', () => paint());
    });
  };
  setTimeout(listen, COVER_MS);
  const close = () => panel.remove();
  panel.querySelector('[class*="btn-cancel-"]')!.addEventListener('click', close);
  panel.querySelector('[class*="btn-confirm-"]')!.addEventListener('click', () => {
    const ym = `${YEARS[index[0]!]}-${String(MONTHS[index[1]!]).padStart(2, '0')}`;
    shownEl.textContent = age ? `${ym} (${now[0] - YEARS[index[0]!]!}岁)` : ym;
    close();
  });
  wrapper.appendChild(panel);
}

/** Make the widgets under `doc` behave. `now` is the month a fresh wheel starts on. */
export function behave(doc: Document, now: [number, number] = [2026, 11]): MobilePage {
  const onClick = (e: Event) => {
    const t = e.target as Element;
    if (t.closest('[class*="mobile-dialog-"], [class*="selector-panel-"]')) return;
    const listRoot = t.closest('input[readonly]')?.parentElement;
    if (listRoot?.dataset.options !== undefined) return list(doc, listRoot, page);
    // Only the part showing the value listens: a tap on the label or the box around it opens nothing.
    const box = t.closest('.mobile-text-input__input')?.closest<HTMLElement>('.mobile-text-input');
    if (box) return wheels(doc, box, page, now, !box.classList.contains('date_info_select'));
  };
  const page: MobilePage = { opened: [], tapped: [], stop: () => doc.removeEventListener('click', onClick, true) };
  doc.addEventListener('click', onClick, true);
  return page;
}
