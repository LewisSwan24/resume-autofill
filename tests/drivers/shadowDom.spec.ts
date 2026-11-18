import { expect, test } from '@playwright/test';
import { execIntent, findControlByLabel, injectHarness } from './helpers';

test.describe('Open Shadow DOM & cross-root ARIA driver conformance', () => {
  test('discovers and fills nested Open Shadow DOM inputs, selects, and SmartRecruiters-style shadow fields', async ({ page }) => {
    await page.setContent(`
      <!doctype html>
      <html>
        <body>
          <main id="portal">
            <span id="ext-email-lbl">Work Email Address</span>
            <label for="host-phone">Mobile Phone</label>
            <x-shadow-field id="host-email" label="Primary Email"></x-shadow-field>
            <x-shadow-field id="host-phone"></x-shadow-field>
            <oc-application-form id="sr-form"></oc-application-form>
          </main>
          <script>
            const hostEmail = document.getElementById('host-email');
            const srEmail = hostEmail.attachShadow({ mode: 'open' });
            const innerHost = document.createElement('x-inner-box');
            innerHost.setAttribute('aria-labelledby', 'ext-email-lbl');
            srEmail.appendChild(innerHost);
            const srInner = innerHost.attachShadow({ mode: 'open' });
            srInner.innerHTML = '<input id="shadow-email" type="email" />';

            const hostPhone = document.getElementById('host-phone');
            const srPhone = hostPhone.attachShadow({ mode: 'open' });
            srPhone.innerHTML = '<input id="shadow-phone" type="tel" />';

            const srForm = document.getElementById('sr-form');
            const srFormShadow = srForm.attachShadow({ mode: 'open' });
            srFormShadow.innerHTML = \`
              <label for="sr-degree">Degree</label>
              <select id="sr-degree">
                <option value="">--</option>
                <option value="bachelor">Bachelor</option>
                <option value="master">Master</option>
              </select>
            \`;
          </script>
        </body>
      </html>
    `);

    await injectHarness(page);

    const locatedEmail = await findControlByLabel(page, 'Work Email Address');
    expect(locatedEmail.kind).toBe('text');
    const r1 = await execIntent(page, 'Work Email Address', { kind: 'text', text: 'alice@shadow.test' });
    expect(r1).toMatchObject({ outcome: 'filled', observed: 'alice@shadow.test' });

    const r2 = await execIntent(page, 'Mobile Phone', { kind: 'text', text: '13800009999' });
    expect(r2).toMatchObject({ outcome: 'filled', observed: '13800009999' });

    const r3 = await execIntent(page, 'Degree', { kind: 'choice', display: 'Master', query: 'Master' });
    expect(r3).toMatchObject({ outcome: 'filled', observed: 'Master' });
  });
});
