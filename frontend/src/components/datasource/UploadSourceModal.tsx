import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { UploadCloud } from 'lucide-react'
import { ModalShell } from '../ui/ModalShell'
import { useDatasourceStore } from '../../store/datasourceStore'

interface Props {
  open: boolean
  onClose: () => void
}

export function UploadSourceModal({ open, onClose }: Props) {
  const { t } = useTranslation()
  const uploadFile = useDatasourceStore((s) => s.uploadFile)
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!file || busy) return
    setBusy(true)
    try {
      await uploadFile(file, name.trim())
      setFile(null)
      setName('')
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
      title={t('uploadSourceModal.title')}
      subtitle={t('uploadSourceModal.subtitle')}
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl px-4 py-2 text-sm text-ink-soft transition hover:text-ink">
            {t('uploadSourceModal.cancel')}
          </button>
          <button
            onClick={submit}
            disabled={!file || busy}
            className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press active:translate-y-px disabled:opacity-60"
          >
            {busy ? t('uploadSourceModal.uploading') : t('uploadSourceModal.upload')}
          </button>
        </div>
      }
    >
      <div className="space-y-3 p-5">
        <button
          onClick={() => inputRef.current?.click()}
          className="plot-grid flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-line px-4 py-8 text-center transition hover:border-accent"
        >
          <UploadCloud size={22} className="text-accent" />
          <span className="text-sm text-ink">
            {file ? file.name : t('uploadSourceModal.clickToSelect')}
          </span>
          <span className="text-xs text-ink-faint">{t('uploadSourceModal.fileHint')}</span>
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null
            setFile(f)
            if (f && !name) setName(f.name.replace(/\.[^.]+$/, ''))
          }}
        />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('uploadSourceModal.namePlaceholder')}
          className="w-full rounded-xl border border-line bg-surface-2 px-4 py-2.5 text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
        />
      </div>
    </ModalShell>
  )
}
