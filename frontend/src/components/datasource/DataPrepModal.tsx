import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { Database, Save, Wand2 } from 'lucide-react'
import { ModalShell } from '../ui/ModalShell'
import * as api from '../../api/dataprep'
import type { DataPrepPreview, DataSource } from '../../types'

interface Props {
  open: boolean
  onClose: () => void
  sources: DataSource[]
  onSaved: () => void
}

/** Kodsuz data hazırlıq: NL → SELECT önizləməsi → yeni mənbə kimi saxla. */
export function DataPrepModal({ open, onClose, sources, onSaved }: Props) {
  const { t } = useTranslation()
  const [datasourceId, setDatasourceId] = useState<string | null>(null)
  const [instruction, setInstruction] = useState('')
  const [preview, setPreview] = useState<DataPrepPreview | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)

  const reset = () => {
    setInstruction('')
    setPreview(null)
    setName('')
  }

  const runPreview = async () => {
    if (!instruction.trim() || busy) return
    setBusy(true)
    setPreview(null)
    try {
      setPreview(await api.previewTransform(datasourceId, instruction.trim()))
    } catch {
      /* interceptor toast */
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    if (!preview?.sql || !name.trim() || saving) return
    setSaving(true)
    try {
      await api.materializeTransform(datasourceId, preview.sql, name.trim())
      toast.success(t('dataPrepModal.savedToast'))
      onSaved()
      reset()
      onClose()
    } catch {
      /* interceptor toast */
    } finally {
      setSaving(false)
    }
  }

  const cols = preview?.columns ?? []

  const fmtCell = (v: unknown): string => {
    if (v === null || v === undefined) return ''
    if (typeof v === 'object') return JSON.stringify(v)
    return String(v)
  }

  return (
    <ModalShell
      open={open}
      onClose={busy || saving ? () => undefined : onClose}
      title={t('dataPrepModal.title')}
      subtitle={t('dataPrepModal.subtitle')}
      footer={
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={busy || saving}
            className="rounded-xl px-4 py-2 text-sm text-ink-soft transition hover:text-ink disabled:opacity-50"
          >
            {t('dataPrepModal.close')}
          </button>
          {preview && (
            <button
              onClick={save}
              disabled={saving || !name.trim()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press active:translate-y-px disabled:opacity-60"
            >
              <Save size={15} /> {saving ? t('dataPrepModal.saving') : t('dataPrepModal.saveAsSource')}
            </button>
          )}
        </div>
      }
    >
      <div className="space-y-3 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm">
            <Database size={14} className="text-accent" />
            <select
              value={datasourceId ?? ''}
              onChange={(e) => {
                setDatasourceId(e.target.value || null)
                setPreview(null)
              }}
              className="bg-transparent text-ink focus:outline-none"
            >
              <option value="">{t('dataPrepModal.demoData')}</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          rows={3}
          placeholder={t('dataPrepModal.instructionPlaceholder')}
          className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
        />
        <div className="flex justify-end">
          <button
            onClick={runPreview}
            disabled={busy || !instruction.trim()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-accent/40 bg-accent-soft px-3 py-2 text-sm font-semibold text-accent transition hover:border-accent disabled:opacity-60"
          >
            <Wand2 size={15} className={busy ? 'animate-pulse' : ''} />
            {busy ? t('dataPrepModal.previewing') : t('dataPrepModal.preview')}
          </button>
        </div>

        {preview && (
          <div className="space-y-3">
            {preview.steps.length > 0 && (
              <ul className="space-y-1 rounded-xl border border-line bg-surface-2 p-3 text-sm text-ink-soft">
                {preview.steps.map((s, i) => (
                  <li key={i}>• {s}</li>
                ))}
              </ul>
            )}
            {preview.warnings.length > 0 && (
              <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-300">
                {preview.warnings.join(' · ')}
              </p>
            )}
            <pre className="overflow-x-auto rounded-xl border border-line bg-surface-2 p-3 font-mono text-[11px] text-ink-soft">
              {preview.sql}
            </pre>
            {cols.length > 0 && (
              <div className="max-h-56 overflow-auto rounded-xl border border-line">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-surface-2">
                    <tr>
                      {cols.map((c) => (
                        <th key={c} className="px-3 py-1.5 font-mono font-medium text-ink">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.slice(0, 50).map((row, i) => (
                      <tr key={i} className="border-t border-line">
                        {cols.map((c) => (
                          <td key={c} className="px-3 py-1.5 text-ink-soft">
                            {fmtCell(row[c])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('dataPrepModal.newSourceNamePlaceholder')}
              className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
            />
          </div>
        )}
      </div>
    </ModalShell>
  )
}
