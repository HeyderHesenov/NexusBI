import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { Code2, Copy, Link2 } from 'lucide-react'
import { ModalShell } from '../ui/ModalShell'
import * as dashApi from '../../api/dashboard'

interface Props {
  open: boolean
  onClose: () => void
  dashboardId: string
}

export function ShareDashboardModal({ open, onClose, dashboardId }: Props) {
  const { t } = useTranslation()
  const [token, setToken] = useState<string | null>(null)
  const [embedToken, setEmbedToken] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const url = token ? `${window.location.origin}/public/${token}` : ''
  const embed = token
    ? `<iframe src="${url}" width="100%" height="600" frameborder="0"></iframe>`
    : ''
  const embedUrl = embedToken ? `${window.location.origin}/embed/${embedToken}` : ''
  const embedIframe = embedToken
    ? `<iframe src="${embedUrl}" width="100%" height="600" frameborder="0"></iframe>`
    : ''
  const sdkSnippet = embedToken
    ? `<div data-nexusbi-embed="${embedToken}"></div>\n<script src="${window.location.origin}/embed.js"></script>`
    : ''

  const toggleEmbed = async () => {
    setBusy(true)
    try {
      if (embedToken) {
        await dashApi.setEmbed(dashboardId, false)
        setEmbedToken(null)
        toast.success(t('shareDashboardModal.embedDisabled'))
      } else {
        const res = await dashApi.setEmbed(dashboardId, true)
        setEmbedToken(res.token)
      }
    } finally {
      setBusy(false)
    }
  }

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
      toast.success(t('shareDashboardModal.shareRevoked'))
    } finally {
      setBusy(false)
    }
  }

  const copy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => toast.success(t('shareDashboardModal.copied')))
  }

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title={t('shareDashboardModal.title')}
      subtitle={t('shareDashboardModal.subtitle')}
      footer={
        <div className="flex justify-between gap-2">
          {token ? (
            <button onClick={revoke} disabled={busy} className="rounded-xl px-4 py-2 text-sm text-[#D87C6B] transition hover:opacity-80">
              {t('shareDashboardModal.revokeShare')}
            </button>
          ) : (
            <span />
          )}
          <button onClick={onClose} className="rounded-xl px-4 py-2 text-sm text-ink-soft transition hover:text-ink">
            {t('shareDashboardModal.close')}
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
            <Link2 size={15} /> {t('shareDashboardModal.createPublicLink')}
          </button>
        ) : (
          <>
            <Field label={t('shareDashboardModal.publicLinkLabel')} value={url} onCopy={() => copy(url)} />
            <Field label={t('shareDashboardModal.embedIframeLabel')} value={embed} onCopy={() => copy(embed)} mono />
            <p className="text-xs text-ink-faint">
              {t('shareDashboardModal.publicLinkHint')}
            </p>
          </>
        )}

        <div className="border-t border-line pt-3">
          <div className="mb-2 flex items-center gap-2">
            <Code2 size={15} className="text-accent" />
            <span className="eyebrow text-ink-soft">{t('shareDashboardModal.whiteLabelEmbed')}</span>
          </div>
          {!embedToken ? (
            <button
              onClick={toggleEmbed}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-xl border border-accent/40 bg-accent-soft px-3 py-2 text-sm font-semibold text-accent transition hover:border-accent disabled:opacity-60"
            >
              <Code2 size={15} /> {t('shareDashboardModal.enableEmbed')}
            </button>
          ) : (
            <div className="space-y-3">
              <Field label="iframe" value={embedIframe} onCopy={() => copy(embedIframe)} mono />
              <Field label="SDK (embed.js)" value={sdkSnippet} onCopy={() => copy(sdkSnippet)} mono />
              <button
                onClick={toggleEmbed}
                disabled={busy}
                className="text-sm text-[#D87C6B] transition hover:opacity-80"
              >
                {t('shareDashboardModal.disableEmbed')}
              </button>
            </div>
          )}
        </div>
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
