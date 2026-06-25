import { useState } from 'react'
import toast from 'react-hot-toast'
import { Copy, Link2 } from 'lucide-react'
import { ModalShell } from '../ui/ModalShell'
import * as dashApi from '../../api/dashboard'

interface Props {
  open: boolean
  onClose: () => void
  dashboardId: string
}

export function ShareDashboardModal({ open, onClose, dashboardId }: Props) {
  const [token, setToken] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const url = token ? `${window.location.origin}/public/${token}` : ''
  const embed = token
    ? `<iframe src="${url}" width="100%" height="600" frameborder="0"></iframe>`
    : ''

  const enable = async () => {
    setBusy(true)
    try {
      setToken(await dashApi.enableShare(dashboardId))
    } finally {
      setBusy(false)
    }
  }

  const revoke = async () => {
    setBusy(true)
    try {
      await dashApi.disableShare(dashboardId)
      setToken(null)
      toast.success('Paylaşım ləğv edildi.')
    } finally {
      setBusy(false)
    }
  }

  const copy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => toast.success('Kopyalandı.'))
  }

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title="Dashboard-u paylaş"
      subtitle="Tokenli read-only link — giriş tələb olunmur."
      footer={
        <div className="flex justify-between gap-2">
          {token ? (
            <button onClick={revoke} disabled={busy} className="rounded-xl px-4 py-2 text-sm text-[#D87C6B] transition hover:opacity-80">
              Paylaşımı ləğv et
            </button>
          ) : (
            <span />
          )}
          <button onClick={onClose} className="rounded-xl px-4 py-2 text-sm text-ink-soft transition hover:text-ink">
            Bağla
          </button>
        </div>
      }
    >
      <div className="space-y-3 p-5">
        {!token ? (
          <button
            onClick={enable}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-bg transition hover:bg-accent-press disabled:opacity-60"
          >
            <Link2 size={15} /> Public link yarat
          </button>
        ) : (
          <>
            <Field label="Public link" value={url} onCopy={() => copy(url)} />
            <Field label="Embed (iframe)" value={embed} onCopy={() => copy(embed)} mono />
            <p className="text-xs text-ink-faint">
              Bu linkə malik hər kəs paneli (yalnız oxuma) görə bilər.
            </p>
          </>
        )}
      </div>
    </ModalShell>
  )
}

function Field({
  label,
  value,
  onCopy,
  mono,
}: {
  label: string
  value: string
  onCopy: () => void
  mono?: boolean
}) {
  return (
    <div>
      <p className="eyebrow mb-1">{label}</p>
      <div className="flex items-center gap-2">
        <input
          readOnly
          value={value}
          className={`w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-ink ${mono ? 'font-mono text-[11px]' : 'text-sm'}`}
        />
        <button
          onClick={onCopy}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-line text-ink-soft transition hover:border-accent hover:text-accent"
        >
          <Copy size={15} />
        </button>
      </div>
    </div>
  )
}
