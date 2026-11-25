// Custom selects as real application forms build them: react-select in several setups, hand-written ARIA
// comboboxes with options loaded on demand, and a file drop zone. No section headings, like most hosted forms.
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import Select from 'react-select';
import AsyncSelect from 'react-select/async';
import { installFixtureState, type FixtureState } from '../shared/state';

interface Option {
  value: string;
  label: string;
}

const opts = (...labels: string[]): Option[] => labels.map((label) => ({ value: label, label }));
const row: CSSProperties = { marginBottom: 16, maxWidth: 480 };
const labelStyle: CSSProperties = { display: 'block', marginBottom: 4 };
const inputStyle: CSSProperties = { width: '100%', padding: 6, boxSizing: 'border-box' };

const COUNTRIES: Option[] = [
  { value: '+93', label: 'Afghanistan +93' },
  { value: '+61', label: 'Australia +61' },
  { value: '+86', label: 'China +86' },
  { value: '+1', label: 'United States +1' },
];
const DEGREES = opts('High school', 'Bachelor', 'Master', 'Doctorate');
const YES_NO = opts('Yes', 'No');
const CITIES = opts('Canberra', 'Melbourne', 'Sydney');
const UNIVERSITIES = opts('Monash University', 'The Australian National University', 'The University of Sydney');
const VISAS = opts('Citizen', 'Permanent resident', 'Student visa');
const EMPLOYMENT = opts('Full time', 'Part time', 'Contract', 'Graduate program');
const HEARD = opts('Indeed', 'LinkedIn', 'Seek', 'Other');
const LOCATIONS = ['Canberra ACT, Australia', 'Melbourne VIC, Australia', 'Sydney NSW, Australia'];
const PLACES = ['Canberra, ACT, Australia', 'Canberra, ACT 2600, Australia', 'Sydney Olympic Park, NSW, Australia'];

const later = <T,>(value: T, ms = 120): Promise<T> => new Promise((resolve) => setTimeout(() => resolve(value), ms));
// `?searchMs=2000` slows the City search down, like a service whose script loads on the first key press.
const CITY_SEARCH_MS = Number(new URLSearchParams(window.location.search).get('searchMs')) || 120;
const search = (list: string[], query: string): string[] => {
  const q = query.trim().toLowerCase();
  return q ? list.filter((item) => item.toLowerCase().includes(q)) : [];
};

/** Input with a list that opens on focus, filters as you type and lives in a portal. */
function InputCombobox(props: {
  id: string;
  options?: string[];
  /** Asked on each keystroke instead of filtering `options`: nothing shows before typing. */
  load?: (query: string) => Promise<string[]>;
  onPick: (value: string) => void;
}) {
  const { id, options, load, onPick } = props;
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [found, setFound] = useState<string[]>(options ?? []);
  const [active, setActive] = useState(-1);
  const anchor = useRef<HTMLInputElement>(null);
  const listId = `${id}-list`;

  const update = (query: string): void => {
    setText(query);
    setOpen(true);
    setActive(-1);
    onPick('');
    if (load) void load(query).then(setFound);
    else setFound((options ?? []).filter((o) => o.toLowerCase().includes(query.trim().toLowerCase())));
  };
  const pick = (value: string): void => {
    setText(value);
    setOpen(false);
    onPick(value);
  };
  const box = anchor.current?.getBoundingClientRect();

  return (
    <>
      <input
        id={id}
        ref={anchor}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        style={inputStyle}
        value={text}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onChange={(e) => update(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            setOpen(true);
            setActive((a) => Math.min(a + 1, found.length - 1));
          } else if (e.key === 'Enter' && active >= 0 && found[active]) {
            e.preventDefault();
            pick(found[active]!);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      {open &&
        createPortal(
          <ul
            id={listId}
            role="listbox"
            style={{ position: 'absolute', left: box?.left ?? 0, top: (box?.bottom ?? 0) + window.scrollY, margin: 0, padding: 0, background: '#fff', border: '1px solid #888', listStyle: 'none', zIndex: 10, width: box?.width }}
          >
            {found.map((option, i) => (
              <li
                key={option}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                style={{ padding: 4, cursor: 'pointer' }}
                onMouseDown={(e) => {
                  // Keep focus in the input until the choice is made, as real widgets do.
                  e.preventDefault();
                  pick(option);
                }}
              >
                {option}
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </>
  );
}

/** A button that shows the value and opens a list, with no text input at all. */
function ButtonCombobox(props: { id: string; labelId: string; options: Option[]; onPick: (value: string) => void }) {
  const { id, labelId, options, onPick } = props;
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const listId = `${id}-list`;
  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        id={id}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-labelledby={labelId}
        style={inputStyle}
        onClick={() => setOpen(!open)}
      >
        {value || 'Select...'}
      </button>
      {open && (
        <div id={listId} role="listbox" aria-labelledby={labelId} style={{ position: 'absolute', background: '#fff', border: '1px solid #888', width: '100%', zIndex: 10 }}>
          {options.map((option) => (
            <div
              key={option.value}
              role="option"
              aria-selected={option.value === value}
              style={{ padding: 4, cursor: 'pointer' }}
              onClick={() => {
                setValue(option.label);
                setOpen(false);
                onPick(option.label);
              }}
            >
              {option.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Answer buttons with a hidden checkbox behind them. The label points at the checkbox's name, not an id. */
function YesNoButtons(props: { name: string; onPick: (value: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <div>
      {['Yes', 'No'].map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          onClick={() => {
            setValue(option);
            props.onPick(option);
          }}
        >
          {option}
        </button>
      ))}
      <input type="checkbox" tabIndex={-1} name={props.name} checked={value === 'Yes'} readOnly style={{ display: 'none' }} />
    </div>
  );
}

/** The input is hidden and only the zone is shown, like react-dropzone. */
function DropZone(props: { id: string; text: string; onFiles: (names: string[]) => void }) {
  const [names, setNames] = useState<string[]>([]);
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div role="presentation" style={{ border: '2px dashed #888', padding: 16 }} onClick={() => ref.current?.click()}>
      <input
        id={props.id}
        ref={ref}
        type="file"
        tabIndex={-1}
        style={{ display: 'none' }}
        onChange={(e) => {
          const list = [...(e.target.files ?? [])].map((f) => f.name);
          setNames(list);
          props.onFiles(list);
        }}
      />
      <button type="button">{props.text}</button> {names.join(', ')}
    </div>
  );
}

const EMPTY: FixtureState = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  country: '',
  degree: '',
  sponsorship: '',
  cities: [],
  university: '',
  heard: '',
  employment: '',
  city: '',
  currentLocation: '',
  visaType: '',
  privacy: '',
  authorised: '',
  workedHere: '',
  resume: [],
  autofillResume: [],
};

export function App() {
  const [state, setState] = useState<FixtureState>(EMPTY);
  const stateRef = useRef(state);
  stateRef.current = state;
  const set = (key: string) => (value: unknown) => setState((s) => ({ ...s, [key]: value }));
  const employmentLabel = useId();

  useLayoutEffect(() => {
    installFixtureState(() => stateRef.current);
  }, []);
  useEffect(() => {
    document.title = 'Custom select fixture';
  }, []);

  const pickOne = (key: string) => (option: Option | null) => set(key)(option?.value ?? '');
  const text = (id: string, label: string, key: string, type = 'text') => (
    <div style={row}>
      <label htmlFor={id} style={labelStyle}>{label}</label>
      <input id={id} type={type} style={inputStyle} value={state[key] as string} onChange={(e) => set(key)(e.target.value)} />
    </div>
  );

  return (
    <form onSubmit={(e) => e.preventDefault()} style={{ padding: 24 }}>
      <h1>Apply for this job</h1>

      {text('first_name', 'First Name', 'firstName')}
      {text('last_name', 'Last Name', 'lastName')}
      {text('email', 'Email', 'email', 'email')}
      {text('phone', 'Phone', 'phone', 'tel')}

      <div style={row}>
        <label htmlFor="country" style={labelStyle}>Country</label>
        {/* The chosen value shows only the dial code, not the option's text. */}
        <Select
          inputId="country"
          classNamePrefix="select"
          options={COUNTRIES}
          placeholder="Select..."
          formatOptionLabel={(option, meta) => (meta.context === 'value' ? option.value : option.label)}
          onChange={pickOne('country')}
        />
      </div>

      <div style={row}>
        <label htmlFor="degree" style={labelStyle}>Highest degree</label>
        {/* No classNamePrefix: only generated class names. */}
        <Select inputId="degree" options={DEGREES} onChange={pickOne('degree')} />
      </div>

      <div style={row}>
        <label htmlFor="sponsorship" style={labelStyle}>Do you require visa sponsorship?</label>
        {/* `required` renders a hidden input next to the real one, which must not be taken for a field. */}
        <Select inputId="sponsorship" classNamePrefix="select" options={YES_NO} required onChange={pickOne('sponsorship')} />
      </div>

      <div style={row}>
        <label htmlFor="cities" style={labelStyle}>Preferred cities</label>
        <Select
          inputId="cities"
          classNamePrefix="select"
          isMulti
          options={CITIES}
          onChange={(list) => set('cities')(list.map((o) => o.value))}
        />
      </div>

      <div style={row}>
        <label htmlFor="university" style={labelStyle}>University</label>
        {/* Nothing is listed until something is typed, and the answer takes a moment. */}
        <AsyncSelect
          inputId="university"
          classNamePrefix="select"
          loadOptions={(query: string) => later(UNIVERSITIES.filter((o) => o.label.toLowerCase().includes(query.toLowerCase())))}
          onChange={pickOne('university')}
        />
      </div>

      <div style={row}>
        <label htmlFor="heard" style={labelStyle}>How did you hear about us?</label>
        <InputCombobox id="heard" options={HEARD.map((o) => o.label)} onPick={set('heard')} />
      </div>

      <div style={row}>
        <div id={employmentLabel} style={labelStyle}>Employment type</div>
        <ButtonCombobox id="employment" labelId={employmentLabel} options={EMPLOYMENT} onPick={set('employment')} />
      </div>

      <div style={row}>
        <label htmlFor="city" style={labelStyle}>City</label>
        <InputCombobox id="city" load={(q) => later(search(LOCATIONS, q), CITY_SEARCH_MS)} onPick={set('city')} />
      </div>

      <div style={row}>
        <label htmlFor="current_location" style={labelStyle}>Current location</label>
        {/* Two results fit the whole address in the resume: never pick one. */}
        <InputCombobox id="current_location" load={(q) => later(search(PLACES, q))} onPick={set('currentLocation')} />
      </div>

      <div style={row}>
        <label htmlFor="visa_type" style={labelStyle}>Visa type</label>
        {/* Nothing here fits the resume: never pick one. */}
        <Select inputId="visa_type" classNamePrefix="select" options={VISAS} onChange={pickOne('visaType')} />
      </div>

      <div style={row}>
        <label htmlFor="privacy" style={labelStyle}>I agree to the privacy policy</label>
        <Select inputId="privacy" classNamePrefix="select" options={YES_NO} onChange={pickOne('privacy')} />
      </div>

      <div style={row}>
        <label htmlFor="q-authorised" style={labelStyle}>Are you legally authorised to work in Australia?</label>
        <YesNoButtons name="q-authorised" onPick={set('authorised')} />
      </div>

      <div style={row}>
        {/* An application question: the resume's answer to it is kept with the others. */}
        <label htmlFor="q-worked-here" style={labelStyle}>Have you worked for us before?</label>
        <YesNoButtons name="q-worked-here" onPick={set('workedHere')} />
      </div>

      <div style={row}>
        <label htmlFor="resume" style={labelStyle}>Resume/CV</label>
        <DropZone id="resume" text="Upload File" onFiles={set('resume')} />
      </div>

      <div style={row}>
        {/* The site reads this file and overwrites the form with its guess. Filling it would undo the fill. */}
        <label htmlFor="autofill_resume" style={labelStyle}>Autofill from resume</label>
        <DropZone id="autofill_resume" text="Upload file" onFiles={set('autofillResume')} />
      </div>

      <button type="submit">Submit application</button>
    </form>
  );
}
