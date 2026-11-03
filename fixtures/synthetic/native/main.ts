import '../shared/style.css';
import { StateRegistry, installFixtureState, readControl, type Bound, type FixtureState } from '../shared/state';

function q<T extends HTMLElement>(selector: string, root: ParentNode = document): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`fixture: missing ${selector}`);
  return el;
}

// ---- static controls ---------------------------------------------------------------------------
const flat = new StateRegistry();
flat.add('firstName', q('#first-name'));
flat.add('lastName', q('#last-name'));
flat.add('preferredName', q('input[name="preferred_name"]'));
flat.add('email', q('input[aria-label="Email"]'));
flat.add('phoneCountryCode', q('select[name="phone_cc"]'));
flat.add('mobileNumber', q('input[name="phone_number"]'));
flat.add('pronouns', q('#pronouns'));
flat.add('street', q('#street'));
flat.add('suburb', q('input[name="suburb"]'));
flat.add('state', q('#state'));
flat.add('postcode', q('#postcode'));
flat.add('linkedinUrl', q('input[name="linkedin_url"]'));
flat.add('githubProfile', q('#githubProfile'));
flat.add('workRights', q('#work-rights'));
flat.add('visaExpiry', q('#visa-expiry'));
flat.add('requiresSponsorship', Array.from(document.querySelectorAll<HTMLInputElement>('input[name="sponsorship"]')));

// Education: fixed 2-row table; cells are read by column position.
const eduKeys = ['institution', 'degree', 'fieldOfStudy', 'start', 'end'] as const;
const educationRegistry = new StateRegistry();
document.querySelectorAll<HTMLTableRowElement>('#education tbody tr').forEach((row, i) => {
  const cells = Array.from(row.cells);
  eduKeys.forEach((key, c) => educationRegistry.add(`education[${i}].${key}`, q<HTMLElement>('input, select', cells[c]!)));
});

// ---- employment cards ----------------------------------------------------------------------------
interface Card {
  root: HTMLElement;
  fields: Array<[string, Bound]>;
}
const cards: Card[] = [];
let uid = 0;
const list = q<HTMLElement>('#employment-list');

function row(text: string, make: (id: string) => HTMLElement): { wrap: HTMLElement; control: HTMLElement } {
  const id = `emp-${++uid}`;
  const wrap = document.createElement('div');
  wrap.className = 'row';
  const label = document.createElement('label');
  label.htmlFor = id;
  label.textContent = text;
  const control = make(id);
  wrap.append(label, control);
  return { wrap, control };
}

function input(type: string): (id: string) => HTMLInputElement {
  return (id) => {
    const el = document.createElement('input');
    el.id = id;
    el.type = type;
    el.autocomplete = 'off';
    return el;
  };
}

function addEmploymentCard(): void {
  const n = cards.length + 1;
  const root = document.createElement('div');
  root.className = 'card';
  const heading = document.createElement('h3');
  heading.textContent = `Employment ${n}`;
  root.append(heading);

  const fields: Array<[string, Bound]> = [];
  const add = (key: string, text: string, make: (id: string) => HTMLElement) => {
    const { wrap, control } = row(text, make);
    root.append(wrap);
    fields.push([key, control]);
  };

  add('jobTitle', 'Job title', input('text'));
  add('company', 'Company', input('text'));
  add('start', 'Start', input('month'));
  add('end', 'End', input('month'));

  const currentWrap = document.createElement('div');
  currentWrap.className = 'row';
  const currentLabel = document.createElement('label');
  const current = document.createElement('input');
  current.type = 'checkbox';
  currentLabel.append(current, ' I currently work here');
  currentWrap.append(currentLabel);
  root.append(currentWrap);
  fields.push(['current', current]);

  add('description', 'Description', (id) => {
    const ta = document.createElement('textarea');
    ta.id = id;
    ta.rows = 3;
    return ta;
  });

  list.append(root);
  cards.push({ root, fields });
}

addEmploymentCard();
q<HTMLButtonElement>('#add-employment').addEventListener('click', addEmploymentCard);

// ---- remaining controls -----------------------------------------------------------------------
const tail = new StateRegistry();
tail.add('preferredLocation', q('#preferred-location'));
tail.add('aboutYou', q('#about-you'));
tail.add('resume', q('#resume-file'));
tail.add('indigenousStatus', q('#indigenous'));
tail.add('howDidYouHear', q('#how-heard'));
tail.add('verificationCode', q('#verification-code'));
tail.add('privacyAgreed', q('input[name="privacy"]'));

q<HTMLFormElement>('#application').addEventListener('submit', (e) => e.preventDefault());

// ---- fixture contract ------------------------------------------------------------------------------
function frameState(): FixtureState {
  const frame = document.querySelector<HTMLIFrameElement>('iframe[title="Additional questions"]');
  const fn = (frame?.contentWindow as Window | null)?.__fixtureState;
  const inner = typeof fn === 'function' ? fn() : {};
  return Object.fromEntries(Object.entries(inner).map(([k, v]) => [`frame.${k}`, v]));
}

installFixtureState(() => {
  const employment: FixtureState = {};
  cards.forEach((card, i) => {
    for (const [key, bound] of card.fields) employment[`employment[${i}].${key}`] = readControl(bound);
  });
  // Key order is irrelevant for deep-equality, but keep it readable: page order.
  return {
    ...flat.snapshot(),
    ...educationRegistry.snapshot(),
    ...employment,
    ...tail.snapshot(),
    ...frameState(),
  };
});
