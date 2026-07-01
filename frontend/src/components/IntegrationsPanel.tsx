import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { Plug, Plus, Send, Trash2 } from 'lucide-react'
import * as api from '../api/integration'
import type { IntegrationChannel } from '../api/integration'

const TYPES = [
  { value: 'slack', label: 'Slack', hintKey: 'integrationsPanel.hintWebhook' },
  { value: 'teams', label: 'Teams', hintKey: 'integrationsPanel.hintWebhook' },
  { value: 'email', label: 'Email', hintKey: 'integrationsPanel.hintEmail' },
]

/** Manage Slack/Teams/email channels that receive briefs & alerts. */
export function IntegrationsPanel() {
  const { t } = useTranslation()
  const [channels, setChannels] = useState<IntegrationChannel[]>([])
  const [type, setType] = useState('slack')
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () => api.listChannels().then(setChannels).catch(() => undefined)
  useEffect(() => {
    load()
  }, [])

  const add = async () => {
    if (!target.trim() || busy) return
    setBusy(true)
    try {
      await api.createChannel(type, '', target.trim())
      setTarget('')
      await load()
      toast.success(t('integrationsPanel.toastAdded'))
    } catch {
      /* interceptor toast */
    } finally {
      setBusy(false)
    }
  }

  const test = async (id: string) => {
    const ok = await api.testChannel(id).catch(() => false)
    toast[ok ? 'success' : 'error'](ok ? t('integrationsPanel.toastTestSent') : t('integrationsPanel.toastTestFailed'))
  }

  const remove = async (id: string) => {
    await api.deleteChannel(id).catch(() => undefined)
    setChannels((c) => c.filter((x) => x.id !== id))
  }

  const hintKey = TYPES.find((x) => x.value === type)?.hintKey ?? ''
  const hint = hintKey ? t(hintKey) : ''

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center gap-2">
        <Plug size={16} className="text-accent" />
        <h2 className="font-display text-lg font-semibold text-ink">{t('integrationsPanel.title')}</h2>
      </div>
      <p className="mb-3 text-sm text-ink-soft">
        {t('integrationsPanel.description')}
      </p>

      <div className="mb-3 flex flex-wrap gap-2">
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="rounded-xl border border-line bg-surface-2 px-2 py-2 text-sm text-ink focus:outline-none"
        >
          {TYPES.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <input
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder={hint}
          className="flex-1 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
        />
        <button
          onClick={add}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press active:translate-y-px disabled:opacity-60"
        >
          <Plus size={15} /> {t('integrationsPanel.add')}
        </button>
      </div>

      {channels.length > 0 && (
        <ul className="space-y-2">
          {channels.map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm"
            >
              <span className="flex items-center gap-2">
                <span className="rounded-md bg-surface-2 px-2 py-0.5 font-mono text-[10px] uppercase text-ink-soft">
                  {c.type}
                </span>
                <span className="text-ink">{c.name || c.type}</span>
              </span>
              <span className="flex items-center gap-1">
                <button
                  onClick={() => test(c.id)}
                  title={t('integrationsPanel.testTooltip')}
                  className="rounded-md border border-line p-1.5 text-ink-soft transition hover:border-accent hover:text-accent"
                >
                  <Send size={14} />
                </button>
                <button
                  onClick={() => remove(c.id)}
                  title={t('integrationsPanel.deleteTooltip')}
                  className="rounded-md border border-line p-1.5 text-ink-faint transition hover:border-[#D87C6B]/50 hover:text-[#D87C6B]"
                >
                  <Trash2 size={14} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
