import { useState, useRef, useEffect, useCallback, useId } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import { useFloatingStyle, useLayer, useOutsideClose } from './floatingLayer';
import './CustomSelect.css';

export interface CustomSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface CustomSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: CustomSelectOption[];
  /** Names the control; the shown value is appended to the trigger's name. */
  ariaLabel?: string;
  /** Put on the trigger, so a `<label htmlFor>` names it. */
  id?: string;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
  disabled?: boolean;
  /** Shown (muted) when no option has the current value. */
  placeholder?: string;
  /** Extra class on the wrapper (layout rules such as width and flex basis go here). */
  className?: string;
  /**
   * 'plain' (default): the borderless trigger the login language picker uses.
   * 'field': bordered like a form input, full width.
   */
  variant?: 'plain' | 'field';
  /** Smaller field, for dense rows. */
  compact?: boolean;
  'data-testid'?: string;
}

export function CustomSelect({
  value,
  onChange,
  options,
  ariaLabel,
  id,
  ariaLabelledBy,
  ariaDescribedBy,
  disabled = false,
  placeholder,
  className,
  variant = 'plain',
  compact = false,
  'data-testid': testId,
}: CustomSelectProps) {
  const { t } = useTranslation();
  const baseId = useId();
  const listId = `${baseId}-list`;
  const [isOpen, setIsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const typeAheadBuffer = useRef('');
  const typeAheadTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const selectedOption = options.find(opt => opt.value === value);
  const selectedLabel = selectedOption?.label ?? '';
  const showPlaceholder = !selectedOption && placeholder !== undefined;

  // The next enabled option from `from` in direction `step`, wrapping; -1 when every option is disabled.
  const enabledIndex = useCallback(
    (from: number, step: 1 | -1): number => {
      const n = options.length;
      for (let i = 0; i < n; i++) {
        const idx = (((from + step * i) % n) + n) % n;
        if (!options[idx].disabled) return idx;
      }
      return -1;
    },
    [options],
  );

  const close = useCallback((refocus = true) => {
    setIsOpen(false);
    setFocusedIndex(-1);
    if (refocus) triggerRef.current?.focus();
  }, []);

  const open = useCallback(() => {
    if (disabled) return;
    const idx = options.findIndex(opt => opt.value === value && !opt.disabled);
    setFocusedIndex(idx >= 0 ? idx : enabledIndex(0, 1));
    setIsOpen(true);
  }, [disabled, options, value, enabledIndex]);

  const toggle = useCallback(() => {
    if (isOpen) close();
    else open();
  }, [isOpen, open, close]);

  const selectOption = useCallback(
    (option: CustomSelectOption) => {
      if (option.disabled) return;
      // A native select fires no change for the option it already shows.
      if (option.value !== value) onChange(option.value);
      close();
    },
    [onChange, close, value],
  );

  // Escape closes the list and not a dialog under it; Tab closes it and moves on from the trigger.
  useLayer(isOpen, { onEscape: () => close(), onTab: () => close() });
  const markInside = useOutsideClose(isOpen, () => close(false));
  const floatingStyle = useFloatingStyle(isOpen, triggerRef, listRef, { matchWidth: true });

  useEffect(() => {
    if (disabled && isOpen) close(false);
  }, [disabled, isOpen, close]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (disabled) return;
      if (!isOpen) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          open();
        }
        return;
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setFocusedIndex(prev => enabledIndex(prev + 1, 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setFocusedIndex(prev => enabledIndex(prev - 1, -1));
          break;
        case 'Home':
          e.preventDefault();
          setFocusedIndex(enabledIndex(0, 1));
          break;
        case 'End':
          e.preventDefault();
          setFocusedIndex(enabledIndex(options.length - 1, -1));
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          if (focusedIndex >= 0 && focusedIndex < options.length) selectOption(options[focusedIndex]);
          break;
        default:
          if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            typeAheadBuffer.current += e.key.toLowerCase();
            clearTimeout(typeAheadTimer.current);
            typeAheadTimer.current = setTimeout(() => {
              typeAheadBuffer.current = '';
            }, 500);
            const match = options.findIndex(
              opt => !opt.disabled && opt.label.toLowerCase().startsWith(typeAheadBuffer.current),
            );
            if (match >= 0) setFocusedIndex(match);
          }
          break;
      }
    },
    [disabled, isOpen, options, focusedIndex, open, selectOption, enabledIndex],
  );

  useEffect(() => {
    if (isOpen && focusedIndex >= 0 && listRef.current) {
      const items = listRef.current.querySelectorAll<HTMLButtonElement>('.custom-select-option');
      items[focusedIndex]?.focus();
    }
  }, [isOpen, focusedIndex]);

  useEffect(() => {
    return () => clearTimeout(typeAheadTimer.current);
  }, []);

  const classes = ['custom-select', variant === 'field' ? 'field' : '', compact ? 'compact' : '', className ?? '']
    .filter(Boolean)
    .join(' ');

  // What the control sets, then the value it shows: a name of the purpose alone would hide the shown value.
  const triggerName =
    ariaLabel && selectedLabel ? t('common.joinedName', { first: ariaLabel, second: selectedLabel }) : ariaLabel;

  return (
    <div className={classes} onKeyDown={handleKeyDown} onMouseDownCapture={markInside}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className="custom-select-trigger"
        onClick={toggle}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listId : undefined}
        aria-label={triggerName}
        aria-labelledby={ariaLabel ? undefined : ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        data-value={value}
        data-testid={testId}
      >
        <span className={`custom-select-label${showPlaceholder ? ' placeholder' : ''}`}>
          {showPlaceholder ? placeholder : selectedLabel}
        </span>
        <ChevronDown size={16} className={`custom-select-chevron ${isOpen ? 'open' : ''}`} aria-hidden="true" />
      </button>
      {isOpen &&
        createPortal(
          <div
            className={`custom-select-dropdown${compact ? ' compact' : ''}`}
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={ariaLabel}
            aria-labelledby={ariaLabel ? undefined : (ariaLabelledBy ?? id)}
            style={floatingStyle}
          >
            {options.map((option, index) => (
              <button
                key={option.value}
                id={`${baseId}-opt-${index}`}
                type="button"
                className={`custom-select-option ${option.value === value ? 'selected' : ''} ${index === focusedIndex ? 'focused' : ''}`}
                role="option"
                aria-selected={option.value === value}
                disabled={option.disabled}
                data-value={option.value}
                onClick={() => selectOption(option)}
                onMouseEnter={() => !option.disabled && setFocusedIndex(index)}
                tabIndex={-1}
              >
                {option.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
