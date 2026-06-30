import { useState } from 'react'
import { ModalShell } from '../ui/ModalShell'
import { useDecisionStore } from '../../store/decisionStore'
import type { DecisionCadence, DecisionDirection } from '../../types'

interface Props {
  open: boolean
  onClose: () => void
  insight: string
  queryLogId: string | null
  question?: string
  datasourceId?: string | null
}

const field =
  'w-full rounded-xl border border-line bg-surface-2 px-4 py-2.5 text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none'

export function CreateDecisionModal({ open, onClose, insight, queryLogId, question, datasourceId }: Props) {
  const add = useDecisionStore((s) => s.add)
  const [title, setTitle] = useState('')
  const [action, setAction] = useState('')
  const [track, setTrack] = useState(false)
  const [metricColumn, setMetricColumn] = useState('')
  const [predicted, setPredicted] = useState('')
  const [direction, setDirection] = useState<DecisionDirection>('increase')
  const [cadence, setCadence] = useState<DecisionCadence>('off')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!title.trim() || busy) return
    setBusy(true)
    try {
      await add({
        title: title.trim(),
        insight,
        action: action.trim(),
        query_log_id: queryLogId,
        ...(track && {
          metric_query: question || null,
          metric_column: metricColumn.trim() || null,
          datasource_id: datasourceId ?? null,
          predicted_value: predicted.trim() ? Number(predicted) : null,
          predicted_direction: direction,
          measure_cadence: cadence,
        }),
      })
      setTitle('')
      setAction('')
      setTrack(false)
      setMetricColumn('')
      setPredicted('')
      onClose()
    } catch {
      /* interceptor toast */
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title="Qərara çevir"
      subtitle="Bu insight-dan izlənən, ölçülən bir qərar yarat."
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl px-4 py-2 text-sm text-ink-soft transition hover:text-ink">
            Ləğv et
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press active:translate-y-px disabled:opacity-60"
          >
            Yarat
          </button>
        </div>
      }
    >
      <div className="space-y-3 p-5">
        {insight && (
          <p className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink-soft">
            {insight}
          </p>
        )}
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Qərar başlığı" className={field} />
        <input value={action} onChange={(e) => setAction(e.target.value)} placeholder="Atılacaq addım (opsional)" className={field} />

        <label className="flex cursor-pointer items-center gap-2 pt-1 text-sm text-ink">
          <input type="checkbox" checked={track} onChange={(e) => setTrack(e.target.checked)} className="accent-accent" />
          Metrikə bağla və təsirini izlə
        </label>

        {track && (
          <div className="space-y-3 rounded-xl border border-line bg-surface-2/50 p-3">
            <p className="text-xs text-ink-faint">
              Bu sorğunun nəticəsi baseline kimi tutulur, sonra real təsir avtomatik ölçülür.
            </p>
            <input
              value={metricColumn}
              onChange={(e) => setMetricColumn(e.target.value)}
              placeholder="Metrik sütunu (boş = ilk rəqəmsal sütun)"
              className={field}
            />
            <div className="flex gap-2">
              <input
                type="number"
                value={predicted}
                onChange={(e) => setPredicted(e.target.value)}
                placeholder="Gözlənilən dəyər"
                className={field}
              />
              <select value={direction} onChange={(e) => setDirection(e.target.value as DecisionDirection)} className={field}>
                <option value="increase">Artmalı ↑</option>
                <option value="decrease">Azalmalı ↓</option>
              </select>
            </div>
            <select value={cadence} onChange={(e) => setCadence(e.target.value as DecisionCadence)} className={field}>
              <option value="off">Avtomatik ölçmə yoxdur</option>
              <option value="daily">Gündəlik ölç</option>
              <option value="weekly">Həftəlik ölç</option>
            </select>
          </div>
        )}
      </div>
    </ModalShell>
  )
}
