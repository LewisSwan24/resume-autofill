// Other spellings of countries and states, for reading the results of a place search. Search services
// write "Brisbane, Queensland, AUS" for an address a person wrote as "Brisbane, QLD, Australia".

import { toSimplified } from './normalize';

const COUNTRIES: readonly (readonly string[])[] = [
  ['Australia', 'AUS', 'AU', '澳大利亚', '澳洲'],
  ['New Zealand', 'NZL', 'NZ', '新西兰'],
  ['United States', 'United States of America', 'USA', 'US', '美国'],
  ['United Kingdom', 'GBR', 'UK', '英国'],
  ['Canada', 'CAN', '加拿大'],
  ['China', 'CHN', 'PRC', 'P.R. China', "People's Republic of China", '中国', '中华人民共和国', '中国大陆'],
  ['Singapore', 'SGP', '新加坡'],
  ['Hong Kong', 'HKG', '香港'],
  ['India', 'IND', '印度'],
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

const ASKS_IN_COUNTRY = /^(?:(?:are|do) you\s+)?(?:(?:currently|presently|now)\s+)?(?:located|based|living|residing|reside|live)\s+in\s+(?:the\s+)?([\p{L} ]{2,40}?)[\s?？*]*$/iu;
const ASKS_IN_COUNTRY_ZH = /^(?:请问)?(?:您|你)?(?:目前|现在|当前)?(?:是否)?(?:在|位于|居住在|身在)([\p{Script=Han}]{2,8}?)(?:境内)?(?:吗)?[\s?？*]*$/u;

/**
 * The country a yes-or-no question asks about, when the question asks nothing else: "Are you located in Australia?".
 * The whole question has to fit: "Do you need a visa to live in Australia?" and "Is your referee based in Australia?"
 * end the same way and ask something else. Only a country known by name.
 */
export function countryAskedAbout(question: string): string | null {
  const asked = toSimplified(question);
  const named = (ASKS_IN_COUNTRY.exec(asked) ?? ASKS_IN_COUNTRY_ZH.exec(asked))?.[1];
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
  // "Sydney, New South Wales, 2000": a postcode at the end says nothing about the country.
  const parts = label.split(',').filter((part) => !/^\s*\d+\s*$/.test(part));
  const last = parts[parts.length - 1] ?? '';
  const theirs = groupOf(COUNTRIES, last);
  if (mine && theirs) return mine !== theirs;
  // "Adelaide, SA, South Africa": three parts end in a country, known here or not. Only home or one of its states will do.
  if (!mine || parts.length < 3) return false;
  return !(mine[0] === 'Australia' && STATES.some((group) => group.some((state) => saysState(last, state))));
}
