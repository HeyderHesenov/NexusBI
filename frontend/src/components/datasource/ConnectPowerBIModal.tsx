import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ModalShell } from '../ui/ModalShell'
import { useDatasourceStore } from '../../store/datasourceStore'
import * as dsApi from '../../api/datasource'
import type { PowerBIDataset } from '../../types'

interface Props {
  open: boolean
  onClose: () => void
}

const field =
  'w-full rounded-xl border border-line bg-surface-2 px-4 py-2.5 text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none'

export function ConnectPowerBIModal({ open, onClose }: Props) {
  const { t } = useTranslation()
  const connect = useDatasourceStore((s) => s.connectPowerBI)
  const [datasets, setDatasets] = useState<PowerBIDataset[]>([])
  const [datasetId, setDatasetId] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    dsApi
      .listPowerBIDatasets()
      .then((ds) => {
        setDatasets(ds)
        if (ds[0]) {
          setDatasetId(ds[0].id)
          setName(ds[0].name)
        }
      })
      .catch(() => undefined)
  }, [open])

  const submit = async () => {
    if (!datasetId || !name.trim() || busy) return
    setBusy(true)
    try {
      await connect(name.trim(), datasetId)
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
      title={t('connectPowerBIModal.title')}
      subtitle={t('connectPowerBIModal.subtitle')}
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl px-4 py-2 text-sm text-ink-soft transition hover:text-ink">
            {t('connectPowerBIModal.cancel')}
          </button>
          <button
            onClick={submit}
            disabled={busy || !datasetId || !name.trim()}
            className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press active:translate-y-px disabled:opacity-60"
          >
            {busy ? t('connectPowerBIModal.connecting') : t('connectPowerBIModal.connect')}
          </button>
        </div>
      }
    >
      <div className="space-y-3 p-5">
        <label className="block text-xs font-medium uppercase tracking-wider text-ink-faint">
          Dataset
        </label>
        <select
          value={datasetId}
          onChange={(e) => {
            setDatasetId(e.target.value)
            const ds = datasets.find((d) => d.id === e.target.value)
            if (ds) setName(ds.name)
          }}
          className={field}
        >
          {datasets.length === 0 && <option value="">{t('connectPowerBIModal.noDataset')}</option>}
          {datasets.map((d) => (
            <option key={d.id} value={d.id}>
              {d.workspace ? `${d.workspace} / ${d.name}` : d.name}
            </option>
          ))}
        </select>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder={t('connectPowerBIModal.sourceNamePlaceholder')}
          className={field}
        />
        <p className="text-xs text-ink-faint">
          {t('connectPowerBIModal.hint')}
        </p>
      </div>
    </ModalShell>
  )
}
