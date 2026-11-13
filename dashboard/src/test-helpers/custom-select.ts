// Drives a CustomSelect (components/CustomSelect.tsx) the way a user does: open the list from its trigger and
// click an option. The caller passes testing-library's fireEvent so the clicks run inside act().
interface FireEvent {
  click: (element: Element) => boolean;
}

/** The value a CustomSelect (or DateTimePicker) trigger currently shows. */
export function selectedValue(trigger: HTMLElement): string {
  const value = trigger.getAttribute('data-value');
  if (value === null) throw new Error('not a CustomSelect trigger (no data-value)');
  return value;
}

/** The option elements of an open CustomSelect list. */
export function openOptions(trigger: HTMLElement): HTMLElement[] {
  const listId = trigger.getAttribute('aria-controls');
  const list = listId ? trigger.ownerDocument.getElementById(listId) : null;
  if (!list) throw new Error('the select list is not open');
  return [...list.querySelectorAll<HTMLElement>('[role="option"]')];
}

/** Opens the select and picks the option with `value`. Throws when the option is missing or disabled. */
export function chooseOption(fireEvent: FireEvent, trigger: HTMLElement, value: string): void {
  if ((trigger as HTMLButtonElement).disabled) throw new Error('the select is disabled');
  if (trigger.getAttribute('aria-expanded') !== 'true') fireEvent.click(trigger);
  const option = openOptions(trigger).find(o => o.getAttribute('data-value') === value);
  if (!option) throw new Error(`no option with value ${JSON.stringify(value)}`);
  if ((option as HTMLButtonElement).disabled) throw new Error(`option ${JSON.stringify(value)} is disabled`);
  fireEvent.click(option);
}

/** [value, label] of every option, opening and closing the list around the read. */
export function optionEntries(fireEvent: FireEvent, trigger: HTMLElement): [string, string][] {
  fireEvent.click(trigger);
  const entries = openOptions(trigger).map(
    o => [o.getAttribute('data-value') ?? '', o.textContent ?? ''] as [string, string],
  );
  fireEvent.click(trigger);
  return entries;
}

/**
 * Sets a DateTimePicker to `value` ('YYYY-MM-DDTHH:mm') as a user does: open it, page to the month, click the
 * day, then pick the hour, minute and (on a 12-hour clock) the period. Leaves the panel open.
 */
export function pickDateTime(fireEvent: FireEvent, trigger: HTMLElement, value: string): void {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) throw new Error(`not a datetime-local value: ${value}`);
  const [, day, hh, mm] = m;
  if (trigger.getAttribute('aria-expanded') !== 'true') fireEvent.click(trigger);
  const panel = (): HTMLElement => {
    const el = trigger.ownerDocument.getElementById(trigger.getAttribute('aria-controls') ?? '');
    if (!el) throw new Error('the date picker is not open');
    return el;
  };
  for (let guard = 0; guard < 1200; guard++) {
    const cell = panel().querySelector<HTMLButtonElement>(`[data-day="${day}"]`);
    if (cell) {
      fireEvent.click(cell);
      break;
    }
    const first = panel().querySelector<HTMLElement>('[data-day]')?.getAttribute('data-day') ?? '';
    const nav = panel().querySelectorAll<HTMLButtonElement>('.dtp-nav');
    fireEvent.click(day < first ? nav[0] : nav[1]);
  }
  const selects = [...panel().querySelectorAll<HTMLElement>('.custom-select-trigger')];
  const named = (prefix: string) => selects.find(s => (s.getAttribute('aria-label') ?? '').startsWith(prefix));
  const hour = Number(hh);
  const period = named('AM or PM');
  if (period) {
    chooseOption(fireEvent, period, hour < 12 ? 'am' : 'pm');
    chooseOption(fireEvent, named('Hour')!, String(hour % 12 === 0 ? 12 : hour % 12));
  } else {
    chooseOption(fireEvent, named('Hour')!, String(hour));
  }
  chooseOption(fireEvent, named('Minute')!, String(Number(mm)));
}
