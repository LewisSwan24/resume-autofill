import { describe, expect, it } from 'vitest';
import { createSampleProfile } from '../../../src/schema/samples';
import { scanDocument } from '../../../src/engine/scan';
import { planFill } from '../../../src/engine/plan';
import {
  RESUME_TEMPLATES,
  formatWithPreset,
  interpolateTemplateText,
  renderResumeDocx,
  renderResumeHtml,
} from '../../../src/templates';

const zhResume = () => structuredClone(createSampleProfile().resumes.find((r) => r.id === 'sample-zh')!);
const enResume = () => structuredClone(createSampleProfile().resumes.find((r) => r.id === 'sample-en')!);

describe('offline resume HTML & Word templates', () => {
  it.each(RESUME_TEMPLATES.map((t) => t.id))('renders %s HTML offline without XSS and produces valid docx bytes', async (templateId) => {
    const resume = enResume();
    resume.basics.preferredName = '<script>alert(1)</script>';
    resume.selfIntroduction = 'Built systems & APIs <tag>';
    const html = renderResumeHtml(resume, templateId);
    expect(html).toContain('<!doctype html>');
    expect(html).not.toContain('http://fonts');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;tag&gt;');

    const docx = await renderResumeDocx(resume, templateId);
    expect(docx).toBeInstanceOf(Uint8Array);
    expect(docx.byteLength).toBeGreaterThan(1000);
    // ZIP / .docx container starts with PK\x03\x04
    expect(docx[0]).toBe(0x50);
    expect(docx[1]).toBe(0x4b);
  });

  it('includes work rights and referees in au_grad template and two-column grid in compact_two_col', () => {
    const resume = enResume();
    resume.referees = [{ name: 'Dr. Jane Smith', title: 'Supervisor', company: 'UWA', email: 'jane@uwa.edu.au', phone: '', relationship: 'Academic' }];
    const auHtml = renderResumeHtml(resume, 'au_grad');
    expect(auHtml).toContain('Referees');
    expect(auHtml).toContain('Dr. Jane Smith');
    expect(auHtml).toContain('Work rights:');

    const twoColHtml = renderResumeHtml(zhResume(), 'compact_two_col');
    expect(twoColHtml).toContain('<div class="grid"><aside>');
  });
});

describe('mapping presets and placeholder interpolation', () => {
  it('interpolates {{company}}, {{role}}, {{name}}, {{school}}, {{major}} from context', () => {
    const resume = enResume();
    const out = interpolateTemplateText('Excited to join {{company}} as {{role}} ({{school}} - {{major}}). Signed {{name}}.', {
      pageUrl: 'https://boards.greenhouse.io/canva/jobs/123',
      pageTitle: 'Graduate Engineer - Canva Careers',
      resume,
    });
    expect(out).toContain('Canva');
    expect(out).toContain(resume.education[0]!.school);
  });

  it('applies au_grad formatting and flows through planFill', () => {
    expect(formatWithPreset('jobIntention.noticePeriod', 'immediately', 'en-AU', 'au_grad')).toBe('Immediately available');

    const resume = enResume();
    resume.selfIntroduction = 'Passionate about working at {{company}}!';
    document.body.innerHTML = '<form><label for="intro">Self introduction</label><textarea id="intro" name="selfIntroduction"></textarea></form>';
    const scan = scanDocument(document);
    const plan = planFill(scan.contexts, scan.classifications, resume, {}, {
      presetId: 'au_grad',
      pageTitle: 'Graduate Engineer - Atlassian',
      pageUrl: 'https://jobs.lever.co/atlassian/role-1',
    });
    const step = plan.steps.find((s) => s.fieldKey === 'misc.selfIntroduction');
    expect(step?.intent.kind).toBe('text');
    if (step?.intent.kind === 'text') {
      expect(step.intent.text.toLowerCase()).toContain('atlassian');
    }
    document.body.replaceChildren();
  });
});
