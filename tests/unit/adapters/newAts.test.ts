import { describe, expect, it } from 'vitest';
import { ADAPTERS } from '../../../src/adapters';
import { resolveAdapter } from '../../../src/adapters/resolve';

describe('New ATS adapters (Ashby, SmartRecruiters, CN Portals)', () => {
  it('resolves Ashby by URL and reads step signature', () => {
    document.body.innerHTML = `
      <div class="ashby-application-form-container">
        <h2>Step 2: Experience & Questions</h2>
      </div>
    `;
    const adapter = resolveAdapter(document, ADAPTERS, 'https://jobs.ashbyhq.com/example/role');
    expect(adapter?.id).toBe('ashby');
    expect(adapter?.stepSignature?.(document)).toBe('Step 2: Experience & Questions');
  });

  it('resolves SmartRecruiters via deep shadow fingerprint and reads active step', () => {
    document.body.innerHTML = `<div id="sr-mount"></div>`;
    const mount = document.getElementById('sr-mount')!;
    const sr = mount.attachShadow({ mode: 'open' });
    sr.innerHTML = `
      <oc-application-form>
        <div class="sr-step active">Personal Information</div>
      </oc-application-form>
    `;
    const adapter = resolveAdapter(document, ADAPTERS, 'https://careers.acme-custom.example/apply');
    expect(adapter?.id).toBe('smartrecruiters');
    expect(adapter?.stepSignature?.(document)).toBe('Personal Information');
  });

  it('resolves ByteDance, Nowcoder, and Tencent campus portals by URL', () => {
    expect(resolveAdapter(document, ADAPTERS, 'https://jobs.bytedance.com/campus/position/123')?.id).toBe('bytedance');
    expect(resolveAdapter(document, ADAPTERS, 'https://www.nowcoder.com/jobs/intern/42')?.id).toBe('nowcoder');
    expect(resolveAdapter(document, ADAPTERS, 'https://join.qq.com/apply.html')?.id).toBe('tencent');
  });
});
