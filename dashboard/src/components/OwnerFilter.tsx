import { useTranslation } from 'react-i18next';
import { UserRound } from 'lucide-react';
import { CustomSelect } from './CustomSelect';
import type { OwnerFilterState } from '../hooks/useOwnerFilter';
import './OwnerFilter.css';

interface OwnerFilterProps {
  /** The page's useOwnerFilter() result. Renders nothing unless the filter is enabled (an unscoped admin). */
  filter: OwnerFilterState;
  compact?: boolean;
  className?: string;
}

/** Admin-only "Owner" filter: All / Admin / each operator or viewer key by name, with session counts. */
export function OwnerFilter({ filter, compact, className }: OwnerFilterProps) {
  const { t } = useTranslation();
  if (!filter.enabled) return null;
  return (
    <div className={`filter-group owner-filter${className ? ` ${className}` : ''}`} data-testid="owner-filter">
      <UserRound size={16} aria-hidden="true" />
      <CustomSelect
        value={filter.owner}
        onChange={filter.setOwner}
        options={filter.options}
        ariaLabel={t('owner.filter.label')}
        compact={compact}
      />
    </div>
  );
}
