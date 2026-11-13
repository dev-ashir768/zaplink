import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { CustomSelect } from './CustomSelect';
import { tabStops, useFloatingStyle, useLayer, useOutsideClose } from './floatingLayer';
import {
  daysIn,
  formatDateTimeLocal,
  pad,
  parseDateTimeLocal,
  type DateTimeParts as Parts,
} from '../utils/dateTimeLocal';
import './DateTimePicker.css';

// A themed replacement for <input type="datetime-local">. The value contract is the same string that input
// produces: local 'YYYY-MM-DDTHH:mm', or '' for no value. Unlike the native field it cannot hold a partly
// filled date: every edit emits a complete value or ''.

interface DateTimePickerProps {
  value: string;
  onChange: (value: string) => void;
  /** Put on the trigger, so a `<label htmlFor>` names it. */
  id?: string;
  /** Earliest selectable value, 'YYYY-MM-DDTHH:mm'. */
  min?: string;
  /** Latest selectable value, 'YYYY-MM-DDTHH:mm'. */
  max?: string;
  disabled?: boolean;
  placeholder?: string;
  ariaDescribedBy?: string;
  /** Force a 12h or 24h clock; by default the UI language's convention is used. */
  hour12?: boolean;
  className?: string;
}

const dayKey = (y: number, m: number, d: number) => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;

function partsOf(date: Date): Parts {
  return {
    y: date.getFullYear(),
    m: date.getMonth() + 1,
    d: date.getDate(),
    h: date.getHours(),
    mi: date.getMinutes(),
  };
}

// A day key shifted by `days` (calendar arithmetic in local time).
function addDays(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d + days);
  return dayKey(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

function addMonths(key: string, months: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const first = new Date(y, m - 1 + months, 1);
  const ny = first.getFullYear();
  const nm = first.getMonth() + 1;
  return dayKey(ny, nm, Math.min(d, daysIn(ny, nm)));
}

function firstDayOfWeek(lang: string): number {
  try {
    const locale = new Intl.Locale(lang) as Intl.Locale & {
      weekInfo?: { firstDay: number };
      getWeekInfo?: () => { firstDay: number };
    };
    const info = locale.getWeekInfo?.() ?? locale.weekInfo;
    if (info) return info.firstDay % 7;
  } catch {
    // An unknown tag falls through to Sunday.
  }
  return 0;
}

function uses12h(lang: string): boolean {
  try {
    const cycle = new Intl.DateTimeFormat(lang, { hour: 'numeric' }).resolvedOptions().hourCycle;
    return cycle === 'h11' || cycle === 'h12';
  } catch {
    return false;
  }
}

export function DateTimePicker({
  value,
  onChange,
  id,
  min,
  max,
  disabled = false,
  placeholder,
  ariaDescribedBy,
  hour12,
  className,
}: DateTimePickerProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language || 'en';
  const twelve = hour12 ?? uses12h(lang);
  const baseId = useId();
  const panelId = `${baseId}-panel`;
  const headingId = `${baseId}-heading`;

  const selected = parseDateTimeLocal(value);
  const minParts = min ? parseDateTimeLocal(min) : null;
  const maxParts = max ? parseDateTimeLocal(max) : null;
  const minDay = minParts ? dayKey(minParts.y, minParts.m, minParts.d) : null;
  const maxDay = maxParts ? dayKey(maxParts.y, maxParts.m, maxParts.d) : null;

  const weekStart = firstDayOfWeek(lang);
  const [open, setOpen] = useState(false);
  // The day keyboard focus sits on in the grid; its month is the month shown.
  const [focusDay, setFocusDay] = useState(() => dayKey(...todayTriple()));
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const focusGridOnRender = useRef(false);

  const [viewY, viewM] = focusDay.split('-').map(Number);
  const today = dayKey(...todayTriple());

  const clamp = useCallback(
    (next: string): string => {
      if (min && parseDateTimeLocal(min) && next < min) return min;
      if (max && parseDateTimeLocal(max) && next > max) return max;
      return next;
    },
    [min, max],
  );

  const emit = useCallback(
    (next: string) => {
      const clamped = next === '' ? '' : clamp(next);
      if (clamped !== value) onChange(clamped);
    },
    [clamp, onChange, value],
  );

  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);

  const openPanel = () => {
    if (disabled) return;
    let start = selected ? dayKey(selected.y, selected.m, selected.d) : today;
    if (minDay && start < minDay) start = minDay;
    if (maxDay && start > maxDay) start = maxDay;
    setFocusDay(start);
    focusGridOnRender.current = true;
    setOpen(true);
  };

  useEffect(() => {
    if (disabled && open) close(false);
  }, [disabled, open, close]);

  useLayer(open, {
    onEscape: () => close(),
    // Tab and Shift+Tab cycle inside the panel, which is a small dialog of its own.
    onTab: event => {
      const panel = panelRef.current;
      if (!panel) return;
      const stops = tabStops(panel);
      if (stops.length === 0) return;
      event.preventDefault();
      const at = stops.indexOf(document.activeElement as HTMLElement);
      const next = event.shiftKey
        ? at <= 0
          ? stops.length - 1
          : at - 1
        : at < 0 || at === stops.length - 1
          ? 0
          : at + 1;
      stops[next].focus();
    },
  });
  const markInside = useOutsideClose(open, () => close(false));
  const floatingStyle = useFloatingStyle(open, triggerRef, panelRef, { matchWidth: false, maxHeight: 520 });

  // Moving the focused day by keyboard moves DOM focus with it.
  useEffect(() => {
    if (!open || !gridRef.current) return;
    const inGrid = gridRef.current.contains(document.activeElement);
    if (!inGrid && !focusGridOnRender.current) return;
    focusGridOnRender.current = false;
    gridRef.current.querySelector<HTMLButtonElement>(`[data-day="${focusDay}"]`)?.focus();
  }, [open, focusDay]);

  const dayDisabled = (key: string) => (minDay !== null && key < minDay) || (maxDay !== null && key > maxDay);

  // A time to pair with a newly picked day when none is set yet: the next whole hour, or 23:00 late at night.
  const defaultTime = (): { h: number; mi: number } => {
    const now = new Date();
    return { h: Math.min(23, now.getHours() + 1), mi: 0 };
  };

  const pickDay = (key: string) => {
    if (dayDisabled(key)) return;
    const [y, m, d] = key.split('-').map(Number);
    const time = selected ?? defaultTime();
    setFocusDay(key);
    emit(formatDateTimeLocal({ y, m, d, h: time.h, mi: time.mi }));
  };

  const setTime = (h: number, mi: number) => {
    const base =
      selected ??
      (() => {
        const [y, m, d] = focusDay.split('-').map(Number);
        return { y, m, d };
      })();
    emit(formatDateTimeLocal({ y: base.y, m: base.m, d: base.d, h, mi }));
  };

  const onGridKeyDown = (e: React.KeyboardEvent) => {
    const rtl = getComputedStyle(e.currentTarget).direction === 'rtl';
    let next: string;
    switch (e.key) {
      case 'ArrowLeft':
        next = addDays(focusDay, rtl ? 1 : -1);
        break;
      case 'ArrowRight':
        next = addDays(focusDay, rtl ? -1 : 1);
        break;
      case 'ArrowUp':
        next = addDays(focusDay, -7);
        break;
      case 'ArrowDown':
        next = addDays(focusDay, 7);
        break;
      case 'Home': {
        const [y, m, d] = focusDay.split('-').map(Number);
        const back = (new Date(y, m - 1, d).getDay() - weekStart + 7) % 7;
        next = addDays(focusDay, -back);
        break;
      }
      case 'End': {
        const [y, m, d] = focusDay.split('-').map(Number);
        const back = (new Date(y, m - 1, d).getDay() - weekStart + 7) % 7;
        next = addDays(focusDay, 6 - back);
        break;
      }
      case 'PageUp':
        next = addMonths(focusDay, e.shiftKey ? -12 : -1);
        break;
      case 'PageDown':
        next = addMonths(focusDay, e.shiftKey ? 12 : 1);
        break;
      default:
        return;
    }
    e.preventDefault();
    if (next.startsWith('0000') || next.length > 10) return;
    setFocusDay(next);
  };

  const weekdayNames = useMemo(() => {
    const short = new Intl.DateTimeFormat(lang, { weekday: 'narrow' });
    const long = new Intl.DateTimeFormat(lang, { weekday: 'long' });
    // 2023-01-01 was a Sunday.
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(2023, 0, 1 + ((weekStart + i) % 7));
      return { short: short.format(date), long: long.format(date) };
    });
  }, [lang, weekStart]);

  const monthLabel = new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric' }).format(
    new Date(viewY, viewM - 1, 1),
  );
  const dayLabel = new Intl.DateTimeFormat(lang, { dateStyle: 'full' });

  // Six weeks, starting on the locale's first weekday on or before the 1st.
  const cells = useMemo(() => {
    const lead = (new Date(viewY, viewM - 1, 1).getDay() - weekStart + 7) % 7;
    const start = addDays(dayKey(viewY, viewM, 1), -lead);
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }, [viewY, viewM, weekStart]);

  const prevMonth = addMonths(focusDay, -1);
  const nextMonth = addMonths(focusDay, 1);
  const prevDisabled = minDay !== null && prevMonth.slice(0, 7) < minDay.slice(0, 7);
  const nextDisabled =
    (maxDay !== null && nextMonth.slice(0, 7) > maxDay.slice(0, 7)) || (viewY >= 9999 && viewM === 12);

  const display = selected
    ? new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short', hour12: twelve }).format(
        new Date(selected.y, selected.m - 1, selected.d, selected.h, selected.mi),
      )
    : '';

  const hour = selected?.h ?? null;
  const minute = selected?.mi ?? null;
  const hourOptions = twelve
    ? Array.from({ length: 12 }, (_, i) => ({ value: String(i === 0 ? 12 : i), label: pad(i === 0 ? 12 : i) }))
    : Array.from({ length: 24 }, (_, i) => ({ value: String(i), label: pad(i) }));
  const minuteOptions = Array.from({ length: 60 }, (_, i) => ({ value: String(i), label: pad(i) }));
  const ampm = new Intl.DateTimeFormat(lang, { hour: 'numeric', hour12: true });
  const periodLabel = (h: number) =>
    ampm.formatToParts(new Date(2023, 0, 1, h)).find(p => p.type === 'dayPeriod')?.value ?? (h < 12 ? 'AM' : 'PM');
  const periodOptions = [
    { value: 'am', label: periodLabel(9) },
    { value: 'pm', label: periodLabel(21) },
  ];
  const hourValue = hour === null ? '' : twelve ? String(hour % 12 === 0 ? 12 : hour % 12) : String(hour);
  const periodValue = hour === null ? '' : hour < 12 ? 'am' : 'pm';
  const fallbackTime = defaultTime();

  const onHour = (v: string) => {
    let h = Number(v);
    if (twelve) {
      const pm = (hour ?? fallbackTime.h) >= 12;
      h = (h % 12) + (pm ? 12 : 0);
    }
    setTime(h, minute ?? 0);
  };
  const onMinute = (v: string) => setTime(hour ?? fallbackTime.h, Number(v));
  const onPeriod = (v: string) => {
    const h = hour ?? fallbackTime.h;
    setTime((h % 12) + (v === 'pm' ? 12 : 0), minute ?? 0);
  };

  const now = () => {
    const p = partsOf(new Date());
    setFocusDay(dayKey(p.y, p.m, p.d));
    emit(formatDateTimeLocal(p));
  };

  return (
    <div className={`dtp${className ? ` ${className}` : ''}`} onMouseDownCapture={markInside}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className="dtp-trigger"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-describedby={ariaDescribedBy}
        data-value={value}
        data-min={min}
        data-max={max}
        onClick={() => (open ? close() : openPanel())}
        onKeyDown={e => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            openPanel();
          }
        }}
      >
        <CalendarDays size={16} className="dtp-trigger-icon" aria-hidden="true" />
        <span className={`dtp-trigger-label${display ? '' : ' placeholder'}`}>
          {display || placeholder || t('common.dateTimePicker.placeholder')}
        </span>
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            id={panelId}
            className="dtp-panel"
            role="dialog"
            aria-label={t('common.dateTimePicker.dialog')}
            style={floatingStyle}
          >
            <div className="dtp-header">
              <button
                type="button"
                className="dtp-nav"
                aria-label={t('common.dateTimePicker.previousMonth')}
                disabled={prevDisabled}
                onClick={() => setFocusDay(dayDisabled(prevMonth) && minDay ? minDay : prevMonth)}
              >
                <ChevronLeft size={16} className="dtp-nav-icon" aria-hidden="true" />
              </button>
              <span id={headingId} className="dtp-month" aria-live="polite">
                {monthLabel}
              </span>
              <button
                type="button"
                className="dtp-nav"
                aria-label={t('common.dateTimePicker.nextMonth')}
                disabled={nextDisabled}
                onClick={() => setFocusDay(dayDisabled(nextMonth) && maxDay ? maxDay : nextMonth)}
              >
                <ChevronRight size={16} className="dtp-nav-icon" aria-hidden="true" />
              </button>
            </div>

            <div className="dtp-grid" role="grid" aria-labelledby={headingId} ref={gridRef} onKeyDown={onGridKeyDown}>
              <div className="dtp-row dtp-weekdays" role="row">
                {weekdayNames.map(w => (
                  <span key={w.long} className="dtp-weekday" role="columnheader" aria-label={w.long}>
                    {w.short}
                  </span>
                ))}
              </div>
              {Array.from({ length: 6 }, (_, week) => (
                <div className="dtp-row" role="row" key={week}>
                  {cells.slice(week * 7, week * 7 + 7).map(key => {
                    const [y, m, d] = key.split('-').map(Number);
                    const isSelected = selected !== null && key === dayKey(selected.y, selected.m, selected.d);
                    const outside = m !== viewM;
                    const off = dayDisabled(key);
                    return (
                      <span role="gridcell" key={key} aria-selected={isSelected}>
                        <button
                          type="button"
                          data-day={key}
                          className={[
                            'dtp-day',
                            outside ? 'outside' : '',
                            key === today ? 'today' : '',
                            isSelected ? 'selected' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          tabIndex={key === focusDay ? 0 : -1}
                          disabled={off}
                          aria-label={dayLabel.format(new Date(y, m - 1, d))}
                          aria-current={key === today ? 'date' : undefined}
                          aria-pressed={isSelected}
                          onClick={() => pickDay(key)}
                        >
                          {d}
                        </button>
                      </span>
                    );
                  })}
                </div>
              ))}
            </div>

            <div className="dtp-time" role="group" aria-label={t('common.dateTimePicker.time')}>
              <CustomSelect
                variant="field"
                compact
                className="dtp-time-select"
                ariaLabel={t('common.dateTimePicker.hour')}
                value={hourValue}
                placeholder="--"
                options={hourOptions}
                onChange={onHour}
              />
              <span className="dtp-time-sep" aria-hidden="true">
                :
              </span>
              <CustomSelect
                variant="field"
                compact
                className="dtp-time-select"
                ariaLabel={t('common.dateTimePicker.minute')}
                value={minute === null ? '' : String(minute)}
                placeholder="--"
                options={minuteOptions}
                onChange={onMinute}
              />
              {twelve && (
                <CustomSelect
                  variant="field"
                  compact
                  className="dtp-time-select dtp-period"
                  ariaLabel={t('common.dateTimePicker.period')}
                  value={periodValue}
                  placeholder="--"
                  options={periodOptions}
                  onChange={onPeriod}
                />
              )}
            </div>

            <div className="dtp-footer">
              <button
                type="button"
                className="dtp-link"
                onClick={() => {
                  emit('');
                  close();
                }}
                disabled={!value}
              >
                <X size={14} aria-hidden="true" />
                {t('common.dateTimePicker.clear')}
              </button>
              <button type="button" className="dtp-link" onClick={now} disabled={dayDisabled(today)}>
                {t('common.dateTimePicker.now')}
              </button>
              <button type="button" className="dtp-done" onClick={() => close()}>
                {t('common.dateTimePicker.done')}
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

function todayTriple(): [number, number, number] {
  const now = new Date();
  return [now.getFullYear(), now.getMonth() + 1, now.getDate()];
}
