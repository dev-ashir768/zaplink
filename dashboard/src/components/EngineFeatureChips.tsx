import { useState } from 'react';
import { useTranslation } from 'react-i18next';

/** How many features show before the "+N more" toggle. */
export const FEATURE_CHIPS_VISIBLE = 5;

/** The features only one engine has, as small chips: the first few, then a "+N more" toggle that expands. */
export function EngineFeatureChips({ label, features }: { label: string; features: readonly string[] }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  if (features.length === 0) return null;
  const hidden = features.length - FEATURE_CHIPS_VISIBLE;
  const shown = expanded || hidden <= 0 ? features : features.slice(0, FEATURE_CHIPS_VISIBLE);
  return (
    <span className="engine-features">
      <span className="engine-fact-key">{label}</span>
      <span className="engine-feature-chips">
        {shown.map(feature => (
          <span key={feature} className="engine-feature-chip">
            {feature}
          </span>
        ))}
        {hidden > 0 && (
          <button
            type="button"
            className="engine-feature-more"
            aria-expanded={expanded}
            onClick={event => {
              // The chips sit inside the engine card's <label>: a click here must not pick the engine.
              event.preventDefault();
              event.stopPropagation();
              setExpanded(value => !value);
            }}
          >
            {expanded
              ? t('infrastructure.engine.fewerFeatures')
              : t('infrastructure.engine.moreFeatures', { count: hidden })}
          </button>
        )}
      </span>
    </span>
  );
}
