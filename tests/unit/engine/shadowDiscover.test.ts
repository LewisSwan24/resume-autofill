import { describe, expect, it } from 'vitest';
import { discover } from '../../../src/engine/discover';
import { collectEvidence } from '../../../src/engine/evidence';

describe('Open Shadow DOM discovery & cross-root evidence', () => {
  it('discovers nested open shadow inputs and resolves outer label[for], host attributes, and cross-root aria-labelledby', () => {
    document.body.innerHTML = `
      <form id="lwc-form">
        <span id="ext-email-heading">Work Email Address *</span>
        <label for="host-phone">Mobile Phone Number</label>

        <x-lwc-field id="host-email" label="Work Email">
          <div class="lwc-outer"></div>
        </x-lwc-field>

        <x-lwc-field id="host-phone">
          <div class="phone-slot"></div>
        </x-lwc-field>
      </form>
    `;

    // Attach open shadow root with inner nested shadow root for email.
    const hostEmail = document.getElementById('host-email')!;
    const srEmail = hostEmail.attachShadow({ mode: 'open' });
    const innerHost = document.createElement('x-inner-input');
    innerHost.setAttribute('aria-labelledby', 'ext-email-heading');
    srEmail.appendChild(innerHost);
    const srInner = innerHost.attachShadow({ mode: 'open' });
    const emailInput = document.createElement('input');
    emailInput.type = 'email';
    srInner.appendChild(emailInput);

    // Attach open shadow root for phone referenced by light DOM <label for="host-phone">.
    const hostPhone = document.getElementById('host-phone')!;
    const srPhone = hostPhone.attachShadow({ mode: 'open' });
    const phoneInput = document.createElement('input');
    phoneInput.type = 'tel';
    srPhone.appendChild(phoneInput);

    const controls = discover(document, { adapter: null });
    expect(controls).toHaveLength(2);
    expect(controls[0]?.el).toBe(emailInput);
    expect(controls[1]?.el).toBe(phoneInput);

    const emailEv = collectEvidence(controls[0]!);
    expect(emailEv.some((e) => e.text.includes('Work Email Address'))).toBe(true);
    expect(emailEv.some((e) => e.text === 'Work Email')).toBe(true);

    const phoneEv = collectEvidence(controls[1]!);
    expect(phoneEv.some((e) => e.text === 'Mobile Phone Number')).toBe(true);
  });
});
