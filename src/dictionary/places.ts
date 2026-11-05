// Other spellings of countries and states, for reading the results of a place search. Search services
// write "Brisbane, Queensland, AUS" for an address a person wrote as "Brisbane, QLD, Australia".

const COUNTRIES: readonly (readonly string[])[] = [
  ['Australia', 'AUS', 'AU'],
  ['New Zealand', 'NZL', 'NZ'],
  ['United States', 'United States of America', 'USA', 'US'],
  ['United Kingdom', 'GBR', 'UK'],
  ['Canada', 'CAN'],
  ['China', 'CHN', '中国'],
  ['Singapore', 'SGP'],
  ['Hong Kong', 'HKG'],
  ['India', 'IND'],
];

const STATES: readonly (readonly string[])[] = [
  ['QLD', 'Queensland'],
  ['NSW', 'New South Wales'],
  ['VIC', 'Victoria'],
  ['TAS', 'Tasmania'],
  ['SA', 'South Australia'],
  ['WA', 'Western Australia'],
  ['NT', 'Northern Territory'],
  ['ACT', 'Australian Capital Territory'],
];

const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();
const groupOf = (groups: readonly (readonly string[])[], name: string): readonly string[] | undefined =>
  groups.find((g) => g.some((n) => same(n, name)));

/** The state table is Australian: WA in another country is something else. */
const usesStateTable = (country: string): boolean => !country.trim() || groupOf(COUNTRIES, country)?.[0] === 'Australia';

const ASKS_IN_COUNTRY = /(?:located|based|living|residing|reside|live)\s+in\s+(?:the\s+)?([\p{L} ]{2,40}?)\s*[?？]?\s*$/iu;
const ASKS_IN_COUNTRY_ZH = /(?:是否|目前)(?:现在)?(?:在|位于|居住在|身在)([\p{Script=Han}]{2,8}?)(?:境内)?\s*[?？]?\s*$/u;

/** The country a yes-or-no question asks about: "Are you located in Australia?". Only a country known by name. */
export function countryAskedAbout(question: string): string | null {
  const named = (ASKS_IN_COUNTRY.exec(question) ?? ASKS_IN_COUNTRY_ZH.exec(question))?.[1];
  return named ? (groupOf(COUNTRIES, named)?.[0] ?? null) : null;
}

/** Whether an address in `home` answers that yes. Null when `home` is empty or not known by name either. */
export function livesInCountry(home: string, asked: string): boolean | null {
  const mine = groupOf(COUNTRIES, home);
  return mine ? mine[0] === asked : null;
}

/** Every way of writing this country or state, the given one first. */
export function placeSpellings(name: string, homeCountry = ''): string[] {
  const group = groupOf(COUNTRIES, name) ?? (usesStateTable(homeCountry) ? groupOf(STATES, name) : undefined) ?? [];
  return [name, ...group.filter((n) => !same(n, name))];
}

/** Short forms count in capitals only, so a word that happens to spell one does not. */
function saysState(text: string, state: string): boolean {
  const flags = state === state.toUpperCase() ? 'u' : 'iu';
  return new RegExp(`(?:^|[^\\p{L}])${state}(?:$|[^\\p{L}])`, flags).test(text);
}

/** True when `text` (a result without its place name) names a known state other than `home`. */
export function namesOtherState(text: string, home: string, homeCountry = ''): boolean {
  if (!usesStateTable(homeCountry)) return false;
  const mine = groupOf(STATES, home);
  return !!mine && STATES.some((group) => group !== mine && group.some((state) => saysState(text, state)));
}

/** True when a result ends in a country that is known not to be `home`. */
export function isInOtherCountry(label: string, home: string): boolean {
  const mine = groupOf(COUNTRIES, home);
  const parts = label.split(',');
  const last = parts[parts.length - 1] ?? '';
  const theirs = groupOf(COUNTRIES, last);
  if (mine && theirs) return mine !== theirs;
  // "Adelaide, SA, South Africa": three parts end in a country, known here or not. Only home or one of its states will do.
  if (!mine || parts.length < 3) return false;
  return !(mine[0] === 'Australia' && STATES.some((group) => group.some((state) => saysState(last, state))));
}
