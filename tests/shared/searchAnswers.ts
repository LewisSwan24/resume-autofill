// Place searches a replay can answer. A location box asks a search service as the applicant types, and a
// recording holds only what was asked while it ran, which was never the sample resume's city. Each answer here
// is what that service sent back on the live page (every write blocked) when "Canberra" was typed into it,
// saved as it came. With it the whole pick runs offline: the page's own script draws the rows, the engine picks
// one, and the page keeps it or not.
//
// Only the exact words asked on the live page get an answer. Anything else stays unanswered and falls through
// to the recording, which aborts it: a replay must not make up a service's answer.
//
// Rippling's box asks Google Places through the Maps script, which no capture holds and which cannot be stood
// in for honestly, so it has nothing here.
//
// School, major and region boxes (Chinese campus portals search all three) follow the same rules. A service
// asks in one of four shapes, each with a reader below: a GET parameter, a POSTed form, a POSTed JSON body, or
// a GraphQL variable. `where` names fields the request always carries, for an endpoint that serves several
// searches (a `type: 'school'` beside a `type: 'major'`).
import type { BrowserContext } from '@playwright/test';

export interface SearchRequest {
  method: string;
  url: string;
  postData: string | null;
}

export interface SearchAnswer {
  contentType: string;
  body: string;
}

export type SearchKind = 'place' | 'school' | 'major' | 'region';

type Asked = (request: SearchRequest, url: URL) => string | null;

export interface SearchService {
  kind: SearchKind;
  /** The words a request searches for, or null when it is not this service's search. */
  asked: Asked;
  /** Words asked → the service's whole answer, as it came. A string is sent as it is; anything else as JSON. */
  answers: Record<string, unknown>;
  /** The content type the service answered with. JSON when left out. */
  contentType?: string;
}

const JSON_TYPE = 'application/json; charset=utf-8';

type Where = Record<string, string | number | boolean>;

const at = (host: string, pathname: string, method: string, request: SearchRequest, url: URL): boolean =>
  request.method === method && url.host === host && url.pathname === pathname;

const parseJson = (text: string | null): unknown => {
  try {
    return JSON.parse(text ?? '');
  } catch {
    return undefined;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

const holds = (read: (key: string) => unknown, where: Where): boolean => Object.entries(where).every(([k, v]) => String(read(k)) === String(v));

/** A GET whose words are one query parameter. */
export const getParam =
  (host: string, pathname: string, param: string, where: Where = {}): Asked =>
  (request, url) =>
    at(host, pathname, 'GET', request, url) && holds((k) => url.searchParams.get(k), where) ? url.searchParams.get(param) : null;

/** A POSTed form (application/x-www-form-urlencoded) whose words are one field. */
export const postFormParam =
  (host: string, pathname: string, param: string, where: Where = {}): Asked =>
  (request, url) => {
    if (!at(host, pathname, 'POST', request, url) || parseJson(request.postData) !== undefined) return null;
    const form = new URLSearchParams(request.postData ?? '');
    return holds((k) => form.get(k), where) ? form.get(param) : null;
  };

/** A POSTed JSON body whose words sit at `field`, a path of keys from the top. */
export const postJsonField =
  (host: string, pathname: string, field: string[], where: Where = {}): Asked =>
  (request, url) => {
    if (!at(host, pathname, 'POST', request, url)) return null;
    const body = parseJson(request.postData);
    if (!isRecord(body) || !holds((k) => body[k], where)) return null;
    let value: unknown = body;
    for (const key of field) value = isRecord(value) ? value[key] : undefined;
    return typeof value === 'string' ? value : null;
  };

/** A GraphQL operation whose words are one variable, POSTed as JSON or sent as GET parameters. */
export const graphqlVariable =
  (host: string, pathname: string, operationName: string, variable: string): Asked =>
  (request, url) => {
    let body: unknown;
    if (at(host, pathname, 'POST', request, url)) body = parseJson(request.postData);
    else if (at(host, pathname, 'GET', request, url)) {
      body = { operationName: url.searchParams.get('operationName'), variables: parseJson(url.searchParams.get('variables')) };
    }
    if (!isRecord(body) || body.operationName !== operationName || !isRecord(body.variables)) return null;
    const words = body.variables[variable];
    return typeof words === 'string' ? words : null;
  };

const ashbyGeoLocation = (name: string, region: string, cityId: string) => ({
  name,
  geoLocationPath: [
    { name: 'Australia', type: 'Country', providerLocationId: 'australia', __typename: 'GeoLocation' },
    { name: region, type: 'Region', providerLocationId: 'australia/australian_capital territory', __typename: 'GeoLocation' },
    { name: name.split(',')[0], type: 'City', providerLocationId: `australia/australian_capital territory/${cityId}`, __typename: 'GeoLocation' },
  ],
  __typename: 'AutocompleteLocation',
});

const SERVICES: SearchService[] = [
  {
    // jobs.lever.co/js/retrieveLocations.js: a GET per pause in typing, an array of { name, id }.
    kind: 'place',
    asked: getParam('jobs.lever.co', '/searchLocations', 'text'),
    answers: {
      Canberra: [
        { name: 'Canberra, Australian Capital Territory, AUS', id: 'ef0d301eeba1a0768f7465a6ec28029458b335a9' },
        { name: 'Canberra, Gweru, Midlands, ZWE', id: '38157a8783b70baa967f0706aee455242fb16e64' },
        { name: 'Canberra, AUS', id: '1a2945f40089d2a7d6d6d0da8e77104f740c06a1' },
      ],
    },
  },
  {
    // Greenhouse's job boards ask a Pelias geocoder (geocode.earth) through their own proxy.
    kind: 'place',
    asked: getParam('api-geocode-earth-proxy.greenhouse.io', '/v1/autocomplete', 'text'),
    answers: {
      Canberra: {
        geocoding: {
          version: '0.2',
          attribution: 'https://geocode.earth/guidelines',
          query: {
            text: 'Canberra',
            parser: 'pelias',
            parsed_text: { subject: 'Canberra', locality: 'Canberra' },
            size: 10,
            layers: ['locality'],
            private: false,
            lang: { name: 'English', iso6391: 'en', iso6393: 'eng', via: 'querystring', defaulted: false },
            querySize: 20,
          },
          engine: { name: 'Pelias', author: 'Mapzen', version: '1.0' },
          timestamp: 1794876049243,
        },
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [149.127306, -35.29885] },
            properties: {
              id: '1377004279',
              gid: 'whosonfirst:locality:1377004279',
              layer: 'locality',
              source: 'whosonfirst',
              source_id: '1377004279',
              country_code: 'AU',
              name: 'Canberra',
              accuracy: 'centroid',
              country: 'Australia',
              country_gid: 'whosonfirst:country:85632793',
              country_a: 'AUS',
              region: 'Australian Capital Territory',
              region_gid: 'whosonfirst:region:85681493',
              region_a: 'ACT',
              localadmin: 'City',
              localadmin_gid: 'whosonfirst:localadmin:404549959',
              locality: 'Canberra',
              locality_gid: 'whosonfirst:locality:1377004279',
              continent: 'Oceania',
              continent_gid: 'whosonfirst:continent:102191583',
              label: 'Canberra, ACT, Australia',
            },
            bbox: [148.995921617, -35.480332289, 149.268147403, -35.139502997],
          },
        ],
        bbox: [148.995921617, -35.480332289, 149.268147403, -35.139502997],
      },
    },
  },
  {
    // Ashby: a GraphQL query, POSTed with the words in its variables.
    kind: 'place',
    asked: graphqlVariable('jobs.ashbyhq.com', '/api/non-user-graphql', 'ApiAutocompleteGeoLocation', 'text'),
    answers: {
      Canberra: {
        data: {
          result: {
            suggestions: [
              ashbyGeoLocation('Canberra, Australian Capital Territory, Australia', 'Australian Capital Territory', 'canberra'),
              ashbyGeoLocation('Canberra Central, Australian Capital Territory, Australia', 'Australian Capital Territory', 'canberra_central'),
            ],
            __typename: 'AutocompleteLocationResult',
          },
        },
      },
    },
  },
];

/** The answer one of these services gave on the live page to this request, or null when there is none. */
export function answerFrom(services: SearchService[], request: SearchRequest): SearchAnswer | null {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return null;
  }
  for (const service of services) {
    const words = service.asked(request, url);
    if (words === null) continue;
    if (!Object.hasOwn(service.answers, words)) return null;
    const saved = service.answers[words];
    return { contentType: service.contentType ?? JSON_TYPE, body: typeof saved === 'string' ? saved : JSON.stringify(saved) };
  }
  return null;
}

/** The service's recorded answer to this request, or null when there is none. */
export function searchAnswer(request: SearchRequest): SearchAnswer | null {
  return answerFrom(SERVICES, request);
}

/** Call after the recording's own route, so this one is asked first. What it cannot answer goes on to the recording. */
export async function answerSearches(context: BrowserContext): Promise<void> {
  await context.route(/^https?:\/\//, (route) => {
    const request = route.request();
    const answer = searchAnswer({ method: request.method(), url: request.url(), postData: request.postData() });
    if (!answer) return route.fallback();
    // The page and the service sit on different hosts for Greenhouse, so the answer has to allow the page.
    const origin = request.headers()['origin'];
    return route.fulfill({
      status: 200,
      contentType: answer.contentType,
      headers: origin ? { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', vary: 'Origin' } : {},
      body: answer.body,
    });
  });
}
