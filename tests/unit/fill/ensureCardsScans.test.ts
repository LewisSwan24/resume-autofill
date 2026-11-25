// Adding cards reads the whole page as few times as it can: a read of a long form takes most of a second. One click
// per section shows whether that section's add button makes a card; a section whose button does gets its other cards
// without a read between clicks, and one read at the end says what came of it all.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as scan from '../../../src/engine/scan';
import { ensureCards } from '../../../src/fill/ensureCards';
import { createSampleProfile } from '../../../src/schema';

vi.mock('../../../src/engine/scan', async (original) => {
  const real = await original<typeof import('../../../src/engine/scan')>();
  return { ...real, scanDocument: vi.fn(real.scanDocument) };
});

const zh = createSampleProfile().resumes.find((r) => r.id === 'sample-zh')!;

const card = (kind: string, n: number) => `<div class="entry"><h4>${kind} ${n}</h4>
  <div class="row"><label for="${kind}a${n}">${kind === '项目经历' ? '项目名称' : '公司名称'}</label><input id="${kind}a${n}"></div>
  <div class="row"><label for="${kind}b${n}">${kind === '项目经历' ? '项目角色' : '职位名称'}</label><input id="${kind}b${n}"></div></div>`;

afterEach(() => {
  document.body.innerHTML = '';
  vi.mocked(scan.scanDocument).mockClear();
});

describe('ensureCards reads the page a fixed few times', () => {
  it('two sections of two cards each: three reads, not one per card', async () => {
    document.body.innerHTML = `<form>
      <h2>实习经历</h2><div id="intern"></div><button type="button" id="add-intern">添加实习经历</button>
      <h2>项目经历</h2><div id="proj"></div><button type="button" id="add-proj">添加项目经历</button></form>`;
    for (const [button, box, kind] of [['add-intern', 'intern', '实习经历'], ['add-proj', 'proj', '项目经历']] as const) {
      document.getElementById(button)!.addEventListener('click', () => {
        const el = document.getElementById(box)!;
        el.insertAdjacentHTML('beforeend', card(kind, el.children.length + 1));
      });
    }
    vi.mocked(scan.scanDocument).mockClear();
    const results = await ensureCards(document, zh, { timeoutMs: 300 });
    expect(document.querySelectorAll('#intern .entry')).toHaveLength(2);
    expect(document.querySelectorAll('#proj .entry')).toHaveLength(2);
    expect(results.find((r) => r.section === 'internship')).toMatchObject({ added: 2, status: 'ok', have: 2, need: 2 });
    expect(results.find((r) => r.section === 'projects')).toMatchObject({ added: 2, status: 'ok', have: 2, need: 2 });
    expect(vi.mocked(scan.scanDocument).mock.calls.length).toBeLessThanOrEqual(3);
  });
});
