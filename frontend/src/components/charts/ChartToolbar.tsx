import { useTranslation } from 'react-i18next'
import type { ChartType } from '../../types'
import { CHART_BTN, OPTIONS } from './chartControls'

interface Props {
  value: ChartType
  onChange: (type: ChartType) => void
}

/** Segmented chart-type switcher — one button per type, current one pressed. */
export function ChartToolbar({ value, onChange }: Props) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-xl border border-line bg-surface-2 p-1">
      {OPTIONS.map(({ type, labelKey, Icon }) => {
        const active = value === type
        const label = t(labelKey)
        return (
          <button
            key={type}
            type="button"
            onClick={() => onChange(type)}
            aria-label={label}
            aria-pressed={active}
            title={label}
            className={`${CHART_BTN} ${
              active ? 'bg-accent text-bg' : 'text-ink-soft hover:bg-surface hover:text-ink'
            }`}
          >
            <Icon size={14} />
            <span className="hidden sm:inline">{label}</span>
          </button>
        )
      })}
    </div>
  )
}
