// @vitest-environment node
// A replay answers each request from its own recording. Two things got in the way on hash-routed apps:
// the snapshot compared the request with a page address that still carried its #/route, and a request that
// differs from the recorded one only in a field the recording could not fix (a timestamp, or a value the page
// read from an answer the recording never held) went unanswered. Neither may ever answer from a different entry.
import { describe, expect, it } from 'vitest';
import { pageShell, sameDocument, stableTwin, type RecordedRequest } from '../../shared/harReplay';

const get = (url: string): RecordedRequest => ({ method: 'GET', url, postData: null });
const post = (url: string, body: unknown): RecordedRequest => ({
  method: 'POST',
  url,
  postData: typeof body === 'string' ? body : JSON.stringify(body),
});
const answered = (request: RecordedRequest, answer: string): RecordedRequest => ({ ...request, answer });

describe('sameDocument', () => {
  it('matches a request with the page address it was asked for, whatever route follows the #', () => {
    expect(sameDocument('https://jobs.example.test/portal/1', 'https://jobs.example.test/portal/1#/job/abc/apply')).toBe(true);
    expect(sameDocument('https://jobs.example.test/m/portal/1', 'https://jobs.example.test/m/portal/1#/resume/abc?x%5B0%5D=1&y=2')).toBe(true);
    expect(sameDocument('https://jobs.example.test/portal/1?a=1', 'https://jobs.example.test/portal/1?a=1')).toBe(true);
  });

  it('still tells different documents apart', () => {
    expect(sameDocument('https://jobs.example.test/portal/2', 'https://jobs.example.test/portal/1#/job/abc')).toBe(false);
    expect(sameDocument('https://jobs.example.test/portal/1?a=2', 'https://jobs.example.test/portal/1?a=1#/x')).toBe(false);
    expect(sameDocument('https://other.example.test/portal/1', 'https://jobs.example.test/portal/1#/x')).toBe(false);
    expect(sameDocument('not a url', 'https://jobs.example.test/portal/1')).toBe(false);
  });
});

describe('stableTwin', () => {
  it('leaves a request the recording holds exactly to the recording', () => {
    const recorded = [get('https://api.example.test/list?_=1700000000000&q=a')];
    expect(stableTwin(get('https://api.example.test/list?_=1700000000000&q=a'), recorded)).toBeNull();
    const body = { orgId: 'demo', ts: 1700000000000 };
    expect(stableTwin(post('https://api.example.test/save', body), [post('https://api.example.test/save', body)])).toBeNull();
  });

  it('answers a GET whose only difference is a cache-busting timestamp from the recorded one', () => {
    const recorded = [get('https://api.example.test/list?q=a&_=1700000000000')];
    expect(stableTwin(get('https://api.example.test/list?_=1800000000000&q=a'), recorded)).toEqual(recorded[0]);
    expect(stableTwin(get('https://api.example.test/list?q=a&t=1800000000'), [get('https://api.example.test/list?q=a&t=1700000000')])).toEqual(
      get('https://api.example.test/list?q=a&t=1700000000'),
    );
  });

  it('answers a POST whose JSON or form body differs only in a timestamp or a nonce', () => {
    const recorded = post('https://api.example.test/query', { orgId: 'demo', page: 1, timestamp: 1700000000000, nonce: 'aa11' });
    expect(stableTwin(post('https://api.example.test/query', { nonce: 'bb22', page: 1, orgId: 'demo', timestamp: 1800000000000 }), [recorded])).toEqual(recorded);
    const form = post('https://api.example.test/form', 'orgId=demo&_t=1700000000000');
    expect(stableTwin(post('https://api.example.test/form', 'orgId=demo&_t=1800000000000'), [form])).toEqual(form);
  });

  it('never answers from an entry whose stable fields differ', () => {
    const recorded = [post('https://api.example.test/query', { orgId: 'demo', page: 1, timestamp: 1700000000000 })];
    expect(stableTwin(post('https://api.example.test/query', { orgId: 'demo', page: 2, timestamp: 1800000000000 }), recorded)).toBeNull();
    expect(stableTwin(post('https://api.example.test/other', { orgId: 'demo', page: 1, timestamp: 1800000000000 }), recorded)).toBeNull();
    expect(stableTwin(get('https://api.example.test/list?q=b&_=1800000000000'), [get('https://api.example.test/list?q=a&_=1700000000000')])).toBeNull();
    expect(stableTwin(get('https://api.example.test/query?orgId=demo'), recorded)).toBeNull();
    expect(stableTwin(get('https://other.example.test/list?q=a&_=1'), [get('https://api.example.test/list?q=a&_=2')])).toBeNull();
  });

  it('only treats a short key as a timestamp when its value looks like one', () => {
    // `t=job` is the page asking for something else, not a cache-buster.
    expect(stableTwin(get('https://api.example.test/list?t=job'), [get('https://api.example.test/list?t=intern')])).toBeNull();
  });

  it('gives no answer when two recorded entries would both fit', () => {
    const recorded = [get('https://api.example.test/list?q=a&_=1700000000000'), get('https://api.example.test/list?q=a&_=1700000000500')];
    expect(stableTwin(get('https://api.example.test/list?q=a&_=1800000000000'), recorded)).toBeNull();
    // Different answers are a real choice, so it stays unanswered.
    const differ = [answered(recorded[0]!, '{"data":true}'), answered(recorded[1]!, '{"data":false}')];
    expect(stableTwin(get('https://api.example.test/list?q=a&_=1800000000000'), differ)).toBeNull();
  });

  it('answers from the first when every entry that fits was answered the same', () => {
    // Feishu asks whether you are logged in three times, each with its own random number, and hears the same each time.
    const status = 'https://jobs.example.test/api/v1/user/mobile/login_status';
    const ok = '{"code":0,"data":true}';
    const recorded = [answered(get(`${status}?random=307331`), ok), answered(get(`${status}?random=337475`), ok)];
    expect(stableTwin(get(`${status}?random=718271`), recorded)).toEqual(recorded[0]);
  });

  it("sets aside ByteDance's per-request signature", () => {
    const posts = 'https://jobs.example.test/api/v1/job/posts/1?portal_type=6&with_recommend=false';
    const recorded = [get(`${posts}&_signature=i1QLPQAAAAA76DgqZLVwwItUCyAAOBi`)];
    expect(stableTwin(get(`${posts}&_signature=_02B4Z6wo00f01otherSignature`), recorded)).toEqual(recorded[0]);
    // Only the signature: another portal type is another question.
    expect(stableTwin(get(`${posts.replace('portal_type=6', 'portal_type=2')}&_signature=x`), recorded)).toBeNull();
  });

  it("answers Moka's form-component lookup, whose cluster the page reads from an answer no recording holds", () => {
    const path = 'https://app.mokahr.com/api/material-platform/meta-info/project';
    const recorded = [get(`${path}?cluster=live-cluster&name=apply-form&project=recruitment-web`)];
    expect(stableTwin(get(`${path}?cluster=prod&name=apply-form&project=recruitment-web`), recorded)).toEqual(recorded[0]);
    // Another project is another answer.
    expect(stableTwin(get(`${path}?cluster=prod&name=apply-form&project=recruitment-mobile`), recorded)).toBeNull();
    // The cluster is only set aside on that one lookup.
    expect(stableTwin(get('https://app.mokahr.com/api/other?cluster=prod'), [get('https://app.mokahr.com/api/other?cluster=live-cluster')])).toBeNull();
  });
});

// A form the applicant reached from the job page without loading a new one (Feishu on a phone): the recording holds
// that page's document only, and the app shows whichever route the address names.
describe('pageShell', () => {
  const doc = (url: string): RecordedRequest => ({ ...get(url), document: true });
  const recorded = [doc('https://jobs.example.test/campus/m/position/1/detail'), get('https://cdn.example.test/app.js'), get('https://jobs.example.test/api/config')];

  it('answers a page the recording never loaded with the document it holds for that site', () => {
    expect(pageShell('https://jobs.example.test/campus/m/resume/1/apply?jobId=1', recorded)?.url).toBe('https://jobs.example.test/campus/m/position/1/detail');
  });

  it('leaves a document the recording holds, and a site it holds none for, alone', () => {
    expect(pageShell('https://jobs.example.test/campus/m/position/1/detail', recorded)).toBeNull();
    expect(pageShell('https://other.example.test/campus/m/resume/1/apply', recorded)).toBeNull();
  });

  it('gives no answer when the recording holds two documents for the site', () => {
    expect(pageShell('https://jobs.example.test/campus/m/resume/1/apply', [...recorded, doc('https://jobs.example.test/campus/m/position/2/detail')])).toBeNull();
  });
});
