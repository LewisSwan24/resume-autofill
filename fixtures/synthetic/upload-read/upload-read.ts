// A form that stores an uploaded resume first and reads it after. While it reads, every field is locked;
// when it is done it writes what it found over them. A fill that goes on while the page is still storing
// the file is overwritten a moment later.

export interface UploadReadState {
  /** The page has read the file and written over the fields. */
  read: boolean;
  /** Typing that reached a field while it was locked. */
  writesWhileLocked: number;
}

declare global {
  interface Window {
    __uploadRead: UploadReadState;
  }
}

const PARSED: Record<string, string> = {
  first_name: 'Parsed',
  last_name: 'Fromfile',
  email: 'parsed@example.test',
};

export function readsUpload(form: HTMLFormElement): void {
  const params = new URLSearchParams(window.location.search);
  const storeMs = Number(params.get('store') ?? 1000);
  const readMs = Number(params.get('read') ?? 700);
  // ?box=photo: the box asks for a photo instead, which the page stores and never reads.
  const photo = params.get('box') === 'photo';
  const state: UploadReadState = { read: false, writesWhileLocked: 0 };
  window.__uploadRead = state;

  const resume = form.querySelector<HTMLInputElement>('[data-testid="input-resume"]')!;
  if (photo) {
    form.querySelector('#field-resume-label')!.textContent = 'Profile photo';
    resume.accept = 'image/*';
  }
  const chips = form.querySelector<HTMLElement>('[data-testid="chips"]')!;
  const slot = form.querySelector<HTMLElement>('[data-testid="notice-slot"]')!;
  const fields = Array.from(form.querySelectorAll<HTMLInputElement>('input[data-input]'));
  let locked = false;
  for (const field of fields) {
    field.addEventListener('input', () => {
      if (locked) state.writesWhileLocked++;
    });
  }

  const lock = (on: boolean): void => {
    locked = on;
    for (const field of fields) field.disabled = on;
    slot.innerHTML = on ? '<div role="alert" data-testid="Parsing the résumé. This might take a few seconds.">Parsing the résumé.</div>' : '';
  };

  resume.addEventListener('change', () => {
    const file = resume.files?.[0];
    if (!file) return;
    chips.innerHTML = '';
    const chip = document.createElement('div');
    chip.setAttribute('data-testid', 'chip');
    chip.textContent = file.name;
    chips.append(chip);
    if (photo) return;
    // Storing the file takes a round trip or two; reading it starts once it is stored.
    setTimeout(() => {
      lock(true);
      setTimeout(() => {
        for (const field of fields) field.value = PARSED[field.dataset.input ?? ''] ?? field.value;
        lock(false);
        state.read = true;
      }, readMs);
    }, storeMs);
  });
}
