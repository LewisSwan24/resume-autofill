import { describe, expect, it } from 'vitest';
import { isListedRead, isSearchRequest, savedSearch } from '../../../scripts/live/searches';

describe('which live requests are searches worth saving', () => {
  it('keeps a page script asking a search endpoint, by GET or POST', () => {
    expect(isSearchRequest('GET', 'https://app.mokahr.com/api/schools/searchV2?keyword=%E6%B5%99', 'xhr')).toBe(true);
    expect(isSearchRequest('POST', 'https://x.zhiye.com/api/dict/search', 'fetch')).toBe(true);
    expect(isSearchRequest('GET', 'https://example.com/major/suggest?q=a', 'fetch')).toBe(true);
  });

  it('leaves out pages, scripts, images and requests that are no search', () => {
    expect(isSearchRequest('GET', 'https://app.mokahr.com/search', 'document')).toBe(false);
    expect(isSearchRequest('GET', 'https://cdn.example.com/search.js', 'script')).toBe(false);
    expect(isSearchRequest('GET', 'https://app.mokahr.com/api/user/info', 'xhr')).toBe(false);
    expect(isSearchRequest('GET', 'ftp://example.com/search', 'xhr')).toBe(false);
  });

  it('saves what was asked and what came back, without the request headers', () => {
    expect(
      savedSearch({ method: 'GET', url: 'https://app.mokahr.com/api/schools/searchV2?keyword=a', postData: null }, 200, 'application/json', '{"data":[]}'),
    ).toEqual({
      method: 'GET',
      url: 'https://app.mokahr.com/api/schools/searchV2?keyword=a',
      postData: null,
      status: 200,
      contentType: 'application/json',
      body: '{"data":[]}',
    });
  });
});

describe('POSTs a site uses to read, let through by name', () => {
  const reads = /^\/api\/outer\/ats-apply\/(privacy-policy\/get|website\/job)$/;
  it('lets through a POST whose path is on the list, and nothing else', () => {
    expect(isListedRead('POST', 'https://app.mokahr.com/api/outer/ats-apply/website/job', reads)).toBe(true);
    expect(isListedRead('POST', 'https://app.mokahr.com/api/outer/ats-apply/website/job/apply', reads)).toBe(false);
    expect(isListedRead('POST', 'https://app.mokahr.com/api/outer/ats-apply/apply/submit', reads)).toBe(false);
    expect(isListedRead('PUT', 'https://app.mokahr.com/api/outer/ats-apply/website/job', reads)).toBe(false);
  });
  it('lets nothing through without a list', () => {
    expect(isListedRead('POST', 'https://app.mokahr.com/api/outer/ats-apply/website/job', null)).toBe(false);
  });
});
