// Server-rendered pages can rebuild the document while they hydrate, which removes anything injected into it.
// Re-appending the same host keeps the mounted UI and its state. A page that keeps removing the host wins
// after a while: fighting it in a loop would hurt the page more than a missing button hurts the user.
const MAX_ATTEMPTS = 20;
const WINDOW_MS = 10_000;

/** Returns a function that stops watching. */
export function keepAttached(host: HTMLElement, doc: Document): () => void {
  let attempts = 0;
  let windowStart = Date.now();

  const observer = new MutationObserver(() => {
    if (host.isConnected || !doc.body) return;
    const now = Date.now();
    if (now - windowStart > WINDOW_MS) {
      windowStart = now;
      attempts = 0;
    }
    if (attempts >= MAX_ATTEMPTS) return;
    attempts++;
    doc.body.append(host);
  });
  observer.observe(doc, { childList: true, subtree: true });
  return () => observer.disconnect();
}
