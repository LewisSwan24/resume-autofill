import { expect, test } from '@playwright/test';
import { execIntent, injectHarness } from './helpers';

test.describe('Virtualized scroll & async Cascader driver conformance', () => {
  test('scrolls a 150-item rc-virtual-list antd select cleanly and terminates by fixed-point when absent', async ({ page }) => {
    await page.setContent(`
      <!doctype html>
      <html>
        <body style="padding: 24px">
          <label for="v_city">City</label>
          <div class="ant-select ant-select-single" style="width: 240px">
            <div class="ant-select-selector">
              <span class="ant-select-selection-search">
                <input id="v_city" class="ant-select-selection-search-input" role="combobox" aria-controls="v_city_list" />
              </span>
              <span class="ant-select-selection-item"></span>
            </div>
          </div>

          <div id="v_popup" class="ant-select-dropdown ant-select-dropdown-hidden" style="position: fixed; left: 24px; top: 64px; width: 240px; display: none; background: #fff; border: 1px solid #ccc;">
            <div id="v_city_list" role="listbox">
              <div class="rc-virtual-list-holder" style="height: 150px; overflow-y: auto; position: relative;">
                <div class="rc-virtual-list-spacer" style="height: 4500px; position: relative;">
                  <div class="rc-virtual-list-holder-inner" style="position: sticky; top: 0;"></div>
                </div>
              </div>
            </div>
          </div>

          <script>
            const TOTAL = 150;
            const ROW_H = 30;
            const WINDOW = 8;
            const root = document.querySelector('.ant-select');
            const selector = document.querySelector('.ant-select-selector');
            const popup = document.getElementById('v_popup');
            const holder = popup.querySelector('.rc-virtual-list-holder');
            const inner = popup.querySelector('.rc-virtual-list-holder-inner');
            const pickedSpan = root.querySelector('.ant-select-selection-item');
            let currentVal = '';

            function renderWindow() {
              const start = Math.max(0, Math.min(TOTAL - WINDOW, Math.floor(holder.scrollTop / ROW_H)));
              inner.innerHTML = '';
              for (let i = start; i < Math.min(TOTAL, start + WINDOW); i++) {
                const label = 'Item ' + i;
                const div = document.createElement('div');
                div.className = 'ant-select-item ant-select-item-option' + (label === currentVal ? ' ant-select-item-option-selected' : '');
                div.setAttribute('title', label);
                div.style.height = ROW_H + 'px';
                div.textContent = label;
                div.addEventListener('click', () => {
                  currentVal = label;
                  pickedSpan.textContent = label;
                  close();
                });
                inner.appendChild(div);
              }
            }

            function open() {
              root.classList.add('ant-select-open');
              popup.classList.remove('ant-select-dropdown-hidden');
              popup.style.display = 'block';
              holder.scrollTop = 0;
              renderWindow();
            }

            function close() {
              root.classList.remove('ant-select-open');
              popup.classList.add('ant-select-dropdown-hidden');
              popup.style.display = 'none';
            }

            selector.addEventListener('click', open);
            holder.addEventListener('scroll', renderWindow);
            document.getElementById('v_city').addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
          </script>
        </body>
      </html>
    `);

    await injectHarness(page);

    const hit = await execIntent(page, 'City', { kind: 'choice', display: 'Item 68', query: 'Item 68' }, { timeoutMs: 8000 });
    expect(hit).toMatchObject({ outcome: 'filled', observed: 'Item 68' });

    const missing = await execIntent(page, 'City', { kind: 'choice', display: 'Item 999', query: 'Item 999' }, { timeoutMs: 8000 });
    expect(missing.outcome).toBe('no_option');
  });

  test('resolves a 3-level Element Plus async cascader where child columns arrive after 150ms', async ({ page }) => {
    await page.setContent(`
      <!doctype html>
      <html>
        <body style="padding: 24px">
          <label for="el_cas_input">Region</label>
          <div class="el-cascader" style="width: 260px">
            <div class="el-input">
              <input id="el_cas_input" class="el-input__inner" aria-controls="el_cas_popper" readonly value="" />
            </div>
          </div>

          <div id="el_cas_popper" class="el-cascader__dropdown" style="position: fixed; left: 24px; top: 64px; display: none; background: #fff; border: 1px solid #ccc;">
            <div class="el-cascader-panel" style="display: flex; gap: 8px;"></div>
          </div>

          <script>
            const root = document.querySelector('.el-cascader');
            const input = document.getElementById('el_cas_input');
            const popper = document.getElementById('el_cas_popper');
            const panel = popper.querySelector('.el-cascader-panel');

            function renderLevel(colIdx, makeItemsFn) {
              while (panel.children.length > colIdx + 1) panel.lastElementChild.remove();
              let ul = panel.children[colIdx];
              if (!ul) {
                ul = document.createElement('ul');
                ul.className = 'el-cascader-menu';
                panel.appendChild(ul);
              }
              ul.innerHTML = '<li class="el-cascader-node"><span class="el-cascader-node__label">加载中</span></li>';
              setTimeout(() => {
                ul.innerHTML = '';
                makeItemsFn(ul);
              }, colIdx === 0 ? 0 : 150);
            }

            root.addEventListener('click', () => {
              popper.style.display = 'block';
              renderLevel(0, (ul) => {
                const li = document.createElement('li');
                li.className = 'el-cascader-node';
                li.setAttribute('aria-haspopup', 'true');
                li.innerHTML = '<span class="el-cascader-node__label">Zhejiang</span>';
                li.onclick = () => {
                  renderLevel(1, (ul1) => {
                    const c = document.createElement('li');
                    c.className = 'el-cascader-node';
                    c.setAttribute('aria-haspopup', 'true');
                    c.innerHTML = '<span class="el-cascader-node__label">Hangzhou</span>';
                    c.onclick = () => {
                      renderLevel(2, (ul2) => {
                        const d = document.createElement('li');
                        d.className = 'el-cascader-node';
                        d.innerHTML = '<span class="el-cascader-node__label">Xihu</span>';
                        d.onclick = () => {
                          input.value = 'Zhejiang / Hangzhou / Xihu';
                          popper.style.display = 'none';
                        };
                        ul2.appendChild(d);
                      });
                    };
                    ul1.appendChild(c);
                  });
                };
                ul.appendChild(li);
              });
            });
          </script>
        </body>
      </html>
    `);

    await injectHarness(page);

    const res = await execIntent(
      page,
      'Region',
      { kind: 'cascade', display: 'Zhejiang / Hangzhou / Xihu', path: ['Zhejiang', 'Hangzhou', 'Xihu'] },
      { timeoutMs: 6000 },
    );
    expect(res).toMatchObject({ outcome: 'filled', observed: 'Zhejiang / Hangzhou / Xihu' });
  });
});
