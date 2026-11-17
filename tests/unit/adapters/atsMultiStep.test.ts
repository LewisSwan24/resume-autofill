import { afterEach, describe, expect, it } from 'vitest';
import { resolveAdapter } from '../../../src/adapters/resolve';
import { runFill } from '../../../src/fill/runFill';
import { createSampleProfile } from '../../../src/schema';

afterEach(() => {
  document.body.replaceChildren();
});

const enResume = () => structuredClone(createSampleProfile().resumes.find((r) => r.id === 'sample-en')!);

describe('Workday / SuccessFactors / PageUp adapters', () => {
  it('resolves Workday by fingerprint, exposes stepSignature, and registers work/education editors', () => {
    document.body.innerHTML = `
      <div data-automation-id="applyFlowPage">
        <div data-automation-id="progressBar"><span aria-current="step">My Information</span></div>
        <h2>My Information</h2>
      </div>
    `;
    const adapter = resolveAdapter(document);
    expect(adapter?.id).toBe('workday');
    expect(adapter?.stepSignature?.(document)).toBe('My Information');
    expect(adapter?.editors?.map((e) => e.section)).toEqual(['work', 'education']);

    const step = document.querySelector('[aria-current="step"]')!;
    step.textContent = 'My Experience';
    expect(adapter?.stepSignature?.(document)).toBe('My Experience');
  });

  it('resolves SuccessFactors synthetic form, skips middleName, and fills fields', async () => {
    document.body.innerHTML = `
      <form id="rcmApplicationForm">
        <h2 class="rcmStepTitle">Step 1: Contact</h2>
        <div class="sf-form-field">
          <span class="sf-form-label">Email</span>
          <input type="email" name="email" />
        </div>
        <div class="sf-form-field">
          <span class="sf-form-label">Middle Name</span>
          <input type="text" name="middleName" />
        </div>
      </form>
    `;
    const adapter = resolveAdapter(document);
    expect(adapter?.id).toBe('successfactors');
    expect(adapter?.stepSignature?.(document)).toBe('Step 1: Contact');

    const resume = enResume();
    const out = await runFill(document, { resume, files: {} });
    expect((document.querySelector('input[name="email"]') as HTMLInputElement).value).toBe(resume.contact.email);
    expect((document.querySelector('input[name="middleName"]') as HTMLInputElement).value).toBe('');
    expect(out.report.counts.filled).toBeGreaterThanOrEqual(1);
  });

  it('resolves PageUp synthetic form, reads stepSignature, and fills applicant fields', async () => {
    document.body.innerHTML = `
      <form id="pu-apply-form">
        <h2 id="pu-step-heading">Personal Details</h2>
        <div class="pu-question">
          <span class="pu-question-text">Email Address</span>
          <input type="email" id="pu-email" />
        </div>
        <div class="pu-question">
          <span class="pu-question-text">Preferred Initials</span>
          <input type="text" name="PreferredNameInitials" />
        </div>
      </form>
    `;
    const adapter = resolveAdapter(document);
    expect(adapter?.id).toBe('pageup');
    expect(adapter?.stepSignature?.(document)).toBe('Personal Details');

    const resume = enResume();
    await runFill(document, { resume, files: {} });
    expect((document.getElementById('pu-email') as HTMLInputElement).value).toBe(resume.contact.email);
    expect((document.querySelector('input[name="PreferredNameInitials"]') as HTMLInputElement).value).toBe('');
  });
});
