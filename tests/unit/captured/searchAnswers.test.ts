// @vitest-environment node
// A replay answers a place search only with what the service itself said on the live page, and only for
// the words it was asked then. Anything else stays unanswered, as before.
import { describe, expect, it } from 'vitest';
import {
  answerFrom,
  getParam,
  graphqlVariable,
  postFormParam,
  postJsonField,
  searchAnswer,
  type SearchService,
} from '../../../tests/shared/searchAnswers';

const ashbyBody = (text: string): string =>
  JSON.stringify({
    operationName: 'ApiAutocompleteGeoLocation',
    variables: { text, locationTypes: ['Country', 'City', 'Region'] },
    query: 'query ApiAutocompleteGeoLocation($text: String!) { result: autocompleteGeoLocation(text: $text) { __typename } }',
  });

const rowsOf = (answer: ReturnType<typeof searchAnswer>): unknown => JSON.parse(answer!.body);

describe('searchAnswer', () => {
  it("answers Lever's location search in its own format", () => {
    const answer = searchAnswer({ method: 'GET', url: 'https://jobs.lever.co/searchLocations?text=Canberra', postData: null });
    expect(answer?.contentType).toMatch(/json/);
    expect((rowsOf(answer) as { name: string }[]).map((r) => r.name)).toContain('Canberra, Australian Capital Territory, AUS');
  });

  it("answers Greenhouse's place search, whatever key and layers the page sends", () => {
    const url = 'https://api-geocode-earth-proxy.greenhouse.io/v1/autocomplete?api_key=any&layers=locality&lang=en&text=Canberra';
    const rows = rowsOf(searchAnswer({ method: 'GET', url, postData: null })) as { features: { properties: { label: string } }[] };
    expect(rows.features.map((f) => f.properties.label)).toEqual(['Canberra, ACT, Australia']);
  });

  it("answers Ashby's place query, which is a GraphQL POST", () => {
    const answer = searchAnswer({
      method: 'POST',
      url: 'https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiAutocompleteGeoLocation',
      postData: ashbyBody('Canberra'),
    });
    const rows = rowsOf(answer) as { data: { result: { suggestions: { name: string }[] } } };
    expect(rows.data.result.suggestions.map((s) => s.name)).toContain('Canberra, Australian Capital Territory, Australia');
  });

  it('leaves a search it has no recorded answer for unanswered', () => {
    expect(searchAnswer({ method: 'GET', url: 'https://jobs.lever.co/searchLocations?text=Canber', postData: null })).toBeNull();
    expect(searchAnswer({ method: 'GET', url: 'https://jobs.lever.co/searchLocations?text=canberra%20act', postData: null })).toBeNull();
    const ashbyUrl = 'https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiAutocompleteGeoLocation';
    expect(searchAnswer({ method: 'POST', url: ashbyUrl, postData: ashbyBody('') })).toBeNull();
    expect(searchAnswer({ method: 'POST', url: ashbyUrl, postData: 'not json' })).toBeNull();
  });

  it('leaves every other request alone', () => {
    expect(searchAnswer({ method: 'GET', url: 'https://jobs.lever.co/example/x/apply?text=Canberra', postData: null })).toBeNull();
    expect(searchAnswer({ method: 'POST', url: 'https://jobs.lever.co/searchLocations?text=Canberra', postData: '' })).toBeNull();
    expect(searchAnswer({ method: 'GET', url: 'https://example.test/v1/autocomplete?text=Canberra', postData: null })).toBeNull();
  });
});

// School, major and region boxes ask in every shape a service can take. These services are made up and live on
// example.test, so the shipped table holds nothing but answers saved from live pages.
describe('school, major and region searches', () => {
  const answers = { 'Example Uni': { rows: [{ name: 'Example University' }] } };
  const ask = (service: SearchService, method: string, url: string, postData: string | null = null) =>
    answerFrom([service], { method, url, postData });
  const json = (value: unknown) => JSON.stringify(value);

  it('reads the words from a GET parameter, and only on that path', () => {
    const service: SearchService = { kind: 'school', asked: getParam('search.example.test', '/school', 'kw'), answers };
    expect(JSON.parse(ask(service, 'GET', 'https://search.example.test/school?kw=Example%20Uni')!.body)).toEqual(answers['Example Uni']);
    expect(ask(service, 'GET', 'https://search.example.test/major?kw=Example%20Uni')).toBeNull();
    expect(ask(service, 'POST', 'https://search.example.test/school?kw=Example%20Uni', '')).toBeNull();
  });

  it('reads the words from a POSTed form', () => {
    const service: SearchService = { kind: 'major', asked: postFormParam('search.example.test', '/major', 'keyword'), answers };
    expect(ask(service, 'POST', 'https://search.example.test/major', 'size=20&keyword=Example+Uni')).not.toBeNull();
    expect(ask(service, 'POST', 'https://search.example.test/major', 'size=20&keyword=Example')).toBeNull();
    expect(ask(service, 'POST', 'https://search.example.test/major', json({ keyword: 'Example Uni' }))).toBeNull();
  });

  it('reads the words from a POSTed JSON body, nested or not', () => {
    const service: SearchService = { kind: 'school', asked: postJsonField('search.example.test', '/api/query', ['filter', 'keyword']), answers };
    const url = 'https://search.example.test/api/query';
    expect(ask(service, 'POST', url, json({ filter: { keyword: 'Example Uni' }, limit: 10 }))).not.toBeNull();
    expect(ask(service, 'POST', url, json({ keyword: 'Example Uni' }))).toBeNull();
    expect(ask(service, 'POST', url, 'filter=Example Uni')).toBeNull();
  });

  it('tells two searches on one endpoint apart by the fields they always send', () => {
    const where = { type: 'school' };
    const school: SearchService = { kind: 'school', asked: postJsonField('search.example.test', '/options', ['keyword'], where), answers };
    const url = 'https://search.example.test/options';
    expect(ask(school, 'POST', url, json({ type: 'school', keyword: 'Example Uni' }))).not.toBeNull();
    expect(ask(school, 'POST', url, json({ type: 'major', keyword: 'Example Uni' }))).toBeNull();
    const region: SearchService = { kind: 'region', asked: getParam('search.example.test', '/options', 'q', { level: '2' }), answers };
    expect(ask(region, 'GET', 'https://search.example.test/options?level=2&q=Example%20Uni')).not.toBeNull();
    expect(ask(region, 'GET', 'https://search.example.test/options?level=3&q=Example%20Uni')).toBeNull();
  });

  it('reads the words from a GraphQL variable, POSTed or in the query string', () => {
    const service: SearchService = { kind: 'region', asked: graphqlVariable('search.example.test', '/graphql', 'SearchRegion', 'text'), answers };
    const url = 'https://search.example.test/graphql';
    expect(ask(service, 'POST', url, json({ operationName: 'SearchRegion', variables: { text: 'Example Uni' } }))).not.toBeNull();
    expect(ask(service, 'POST', url, json({ operationName: 'SearchSchool', variables: { text: 'Example Uni' } }))).toBeNull();
    const vars = encodeURIComponent(json({ text: 'Example Uni' }));
    expect(ask(service, 'GET', `${url}?operationName=SearchRegion&variables=${vars}`)).not.toBeNull();
    expect(ask(service, 'GET', `${url}?operationName=SearchRegion&variables=not-json`)).toBeNull();
  });

  it('answers in the content type the service used', () => {
    const service: SearchService = {
      kind: 'school',
      asked: getParam('search.example.test', '/school', 'kw'),
      contentType: 'text/plain; charset=utf-8',
      answers: { 'Example Uni': 'Example University|1' },
    };
    const answer = ask(service, 'GET', 'https://search.example.test/school?kw=Example%20Uni');
    expect(answer).toEqual({ contentType: 'text/plain; charset=utf-8', body: 'Example University|1' });
  });

  it('gives nothing for words the live page was never asked', () => {
    const service: SearchService = { kind: 'school', asked: getParam('search.example.test', '/school', 'kw'), answers };
    expect(ask(service, 'GET', 'https://search.example.test/school?kw=example%20uni')).toBeNull();
    expect(ask(service, 'GET', 'https://search.example.test/school?kw=Example%20Un')).toBeNull();
    expect(ask(service, 'GET', 'https://search.example.test/school?kw=')).toBeNull();
  });
});
