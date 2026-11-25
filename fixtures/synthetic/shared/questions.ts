// The application-question pages (questions-zh, questions-en): plain controls marked with data-state, read back as
// the fixture contract. Answer buttons keep one pressed at a time, as a page's own yes/no toggles do.
import './style.css';
import { installFixtureState, readControl, type FixtureState } from './state';

for (const group of document.querySelectorAll<HTMLElement>('.answers')) {
  for (const button of group.querySelectorAll<HTMLButtonElement>('button')) {
    button.addEventListener('click', () => {
      for (const other of group.querySelectorAll('button')) other.setAttribute('aria-pressed', String(other === button));
    });
  }
}

document.querySelector('form')?.addEventListener('submit', (e) => e.preventDefault());

installFixtureState(() => {
  const out: FixtureState = {};
  for (const el of document.querySelectorAll<HTMLElement>('[data-state]')) {
    const key = el.dataset.state!;
    if (el.classList.contains('answers')) {
      out[key] = (el.querySelector('button[aria-pressed="true"]')?.textContent ?? '').trim();
    } else if (el.tagName === 'FIELDSET') {
      out[key] = readControl(Array.from(el.querySelectorAll<HTMLInputElement>('input[type=radio]')));
    } else {
      out[key] = readControl(el);
    }
  }
  return out;
});
