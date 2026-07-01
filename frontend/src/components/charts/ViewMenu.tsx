import { useTranslation } from 'react-i18next'
import type { ChartType } from '../../types'
import { ActionMenu } from '../ui/ActionMenu'
import { OPTIONS } from './chartControls'

interface Props {
  value: ChartType
  onChange: (type: ChartType) => void
}

/** Compact chart-type ("view") selector — a single-section {@link ActionMenu}
 *  so it shares the toolbar's trigger style and portal positioning. The trigger
 *  shows the current type's icon; the current type is marked active (checked). */
export function ViewMenu({ value, onChange }: Props) {
  const { t } = useTranslation()
  const current = OPTIONS.find((o) => o.type === value) ?? OPTIONS[0]
  return (
    <ActionMenu
      ariaLabel={t('chartView.view')}
      triggerLabel={t('chartView.view')}
      triggerIcon={current.Icon}
      sections={[
        {
          header: t('chartView.chartTypeGroup'),
          items: OPTIONS.map((o) => ({
            key: o.type,
            label: t(o.labelKey),
            Icon: o.Icon,
            onSelect: () => onChange(o.type),
            active: o.type === value,
          })),
        },
      ]}
    />
  )
}
