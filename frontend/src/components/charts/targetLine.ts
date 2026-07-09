/** Shared prop spec for the KPI-target ReferenceLine so bar/line/area render
 *  the same dashed, muted, labeled line. (A wrapper component would be ignored
 *  by recharts' child-type filtering — spread these props instead.) */
export const targetLineProps = (
  label: string,
  ink: string,
  labelPosition: 'insideTopRight' | 'insideTop' = 'insideTopRight',
) => ({
  stroke: ink,
  strokeDasharray: '6 4',
  strokeWidth: 1.5,
  ifOverflow: 'extendDomain' as const,
  label: { value: label, position: labelPosition, fontSize: 11, fill: ink },
})
