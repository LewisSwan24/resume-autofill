// Multi-step application pages for auto-advance. Every press of a send button is counted in sessionStorage,
// so a test can prove the extension never pressed one.
export const SENT_KEY = 'wizard.sent';

export function countSends(button: HTMLElement, form?: HTMLFormElement | null): void {
  const sent = (e: Event) => {
    e.preventDefault();
    sessionStorage.setItem(SENT_KEY, String(Number(sessionStorage.getItem(SENT_KEY) ?? '0') + 1));
  };
  button.addEventListener('click', sent);
  form?.addEventListener('submit', sent);
}

/** A page form whose Next button (a submit button) loads the next page, keeping what was typed. */
export function goesTo(form: HTMLFormElement, next: string, keep: string[]): void {
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    for (const name of keep) {
      const el = form.elements.namedItem(name) as HTMLInputElement | null;
      sessionStorage.setItem(`wizard.${name}`, el?.value ?? '');
    }
    window.location.href = next;
  });
}

/** One page, three steps: Next checks the step's required fields (marking the empty ones) before showing the next. */
export function singlePage(root: HTMLElement): void {
  const sections = Array.from(root.querySelectorAll<HTMLElement>('section'));
  const show = (i: number) => sections.forEach((s, j) => (s.hidden = j !== i));
  sections.forEach((s, i) => {
    s.querySelector('.next')?.addEventListener('click', () => {
      const required = Array.from(s.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[required]'));
      const empty = required.filter((el) => !el.value.trim());
      for (const el of required) el.setAttribute('aria-invalid', String(empty.includes(el)));
      if (empty.length === 0) show(i + 1);
    });
    s.querySelector('.back')?.addEventListener('click', () => show(i - 1));
  });
}
