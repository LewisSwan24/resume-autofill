import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  addManualApplication,
  deleteApplication,
  filterApplications,
  guessCompany,
  loadApplications,
  mergeTrackerRecords,
  recordFillApplication,
  saveApplications,
  updateApplication,
} from '../../../src/tracker';

beforeEach(() => {
  fakeBrowser.reset();
});

describe('tracker guessCompany', () => {
  it('extracts company from ATS hosts and page titles', () => {
    expect(guessCompany(undefined, 'boards.greenhouse.io')).toBe('');
    expect(guessCompany(undefined, 'app.mokahr.com')).toBe('');
    expect(guessCompany('Software Engineer — Atlassian - Careers', 'jobs.lever.co')).toBe('Atlassian');
    expect(guessCompany('字节跳动招聘官网', 'jobs.bytedance.com')).toBe('字节跳动');
    expect(guessCompany(undefined, 'careers.acme-tech.com')).toBe('acme-tech');
  });
});

describe('extension application tracker store', () => {
  it('records a fill application, avoids duplicates by hash-less url, and upgrades wish -> filling', async () => {
    const manual = await addManualApplication({
      url: 'https://acme.example.com/jobs/1',
      company: 'Acme Corp',
      position: 'Frontend Grad',
      now: 1000,
    });
    expect(manual?.status).toBe('wish');
    expect(manual?.companyGuessed).toBe(false);

    const updated = await recordFillApplication({
      url: 'https://acme.example.com/jobs/1#step2',
      title: 'Frontend Grad - Acme',
      filled: 12,
      attention: 2,
      skipped: 1,
      resumeId: 'sample-en',
      locale: 'en-AU',
      now: 2000,
    });
    expect(updated?.id).toBe(manual?.id);
    expect(updated?.status).toBe('filling');
    expect(updated?.history).toHaveLength(1);
    expect(updated?.company).toBe('Acme Corp');

    const all = await loadApplications();
    expect(all).toHaveLength(1);
  });

  it('updates, filters, deletes, and merges newer tracker records', async () => {
    const a = (await addManualApplication({ url: 'https://one.example/a', company: 'Alpha', position: 'SDE', now: 100 }))!;
    const b = (await addManualApplication({ url: 'https://two.example/b', company: 'Beta', position: 'PM', now: 200 }))!;

    await updateApplication(a.id, { status: 'submitted', notes: 'Submitted online', deadline: { date: '2026-10-15' } }, 300);
    const list = await loadApplications();
    expect(filterApplications(list, 'submitted', 'alpha')).toHaveLength(1);
    expect(filterApplications(list, 'wish', 'pm')).toHaveLength(1);

    const incoming = [{ ...b, status: 'interview' as const, updatedAt: 500 }];
    const merged = mergeTrackerRecords(list, incoming);
    await saveApplications(merged);
    expect((await loadApplications()).find((r) => r.id === b.id)?.status).toBe('interview');

    await deleteApplication(a.id);
    expect(await loadApplications()).toHaveLength(1);
  });
});
