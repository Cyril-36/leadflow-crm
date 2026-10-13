/** Clicking a toast (e.g. "Retry refresh") must not count as a click outside an open dialog. */
export function keepOpenForToasts(event: { target: EventTarget | null; preventDefault: () => void }) {
  if (event.target instanceof Element && event.target.closest("[data-sonner-toaster]")) event.preventDefault();
}
