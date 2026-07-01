import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { History, Plus, Shield, Trash2, UserPlus, Users } from 'lucide-react'
import { useWorkspaceStore } from '../store/workspaceStore'

function fmt(ts: string): string {
  const hasTz = /[zZ]|[+-]\d{2}:?\d{2}$/.test(ts)
  return new Date(hasTz ? ts : `${ts}Z`).toLocaleString('az-AZ', {
    dateStyle: 'short',
    timeStyle: 'short',
  })
}

const ROLES = ['viewer', 'editor', 'owner']

export function WorkspacePage() {
  const { t } = useTranslation()
  const {
    workspaces, members, audit, load, create, loadMembers, addMember, removeMember, loadAudit,
  } = useWorkspaceStore()
  const [name, setName] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('viewer')

  useEffect(() => {
    load().catch(() => undefined)
    loadAudit().catch(() => undefined)
  }, [load, loadAudit])

  const toggle = (id: string) => {
    if (openId === id) return setOpenId(null)
    setOpenId(id)
    loadMembers(id).catch(() => undefined)
  }

  return (
    <div className="w-full">
      <header className="mb-6">
        <p className="eyebrow">{t('workspacePage.eyebrow')}</p>
        <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-ink">{t('workspacePage.title')}</h1>
        <p className="mt-1 text-sm text-ink-soft">
          {t('workspacePage.subtitle')}
        </p>
      </header>

      <div className="mb-5 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('workspacePage.newWorkspacePlaceholder')}
          className="flex-1 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
        />
        <button
          onClick={() => {
            if (name.trim()) {
              create(name.trim()).catch(() => undefined)
              setName('')
            }
          }}
          className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press active:translate-y-px"
        >
          <Plus size={15} /> {t('workspacePage.create')}
        </button>
      </div>

      {workspaces.length === 0 ? (
        <div className="plot-grid grid min-h-[55vh] place-items-center rounded-2xl border border-dashed border-line px-6 py-12 text-center">
          <Users size={22} className="mx-auto text-ink-faint" />
          <p className="mt-2 font-display text-lg text-ink">{t('workspacePage.emptyWorkspaces')}</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {workspaces.map((w) => (
            <li key={w.id} className="rounded-2xl border border-line bg-surface p-4">
              <button onClick={() => toggle(w.id)} className="flex w-full items-center justify-between gap-3 text-left">
                <span className="flex items-center gap-2 font-medium text-ink">
                  <Users size={16} className="text-accent" /> {w.name}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">
                  {w.role}
                </span>
              </button>

              {openId === w.id && (
                <div className="mt-3 space-y-2 border-t border-line pt-3">
                  {(members[w.id] ?? []).map((m) => (
                    <div key={m.id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="text-ink">{m.email}</span>
                      <span className="flex items-center gap-2">
                        <span className="rounded-md bg-surface-2 px-2 py-0.5 font-mono text-[10px] uppercase text-ink-soft">
                          {m.role}
                        </span>
                        {w.role === 'owner' && m.user_id !== w.owner_id && (
                          <button
                            onClick={() => removeMember(w.id, m.id)}
                            className="rounded-md border border-line p-1 text-ink-faint transition hover:border-[#D87C6B]/50 hover:text-[#D87C6B]"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </span>
                    </div>
                  ))}
                  {w.role === 'owner' && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      <input
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder={t('workspacePage.memberEmailPlaceholder')}
                        className="flex-1 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
                      />
                      <select
                        value={role}
                        onChange={(e) => setRole(e.target.value)}
                        className="rounded-lg border border-line bg-surface-2 px-2 py-1.5 text-sm text-ink focus:outline-none"
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => {
                          if (email.trim()) {
                            addMember(w.id, email.trim(), role).catch(() => undefined)
                            setEmail('')
                          }
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent-soft px-3 py-1.5 text-sm font-semibold text-accent transition hover:border-accent"
                      >
                        <UserPlus size={14} /> {t('workspacePage.addMember')}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <section className="mt-8">
        <div className="mb-3 flex items-center gap-2">
          <History size={16} className="text-accent" />
          <h2 className="font-display text-lg font-semibold text-ink">{t('workspacePage.auditLog')}</h2>
        </div>
        {audit.length === 0 ? (
          <p className="text-sm text-ink-faint">{t('workspacePage.emptyAudit')}</p>
        ) : (
          <ul className="space-y-1.5">
            {audit.map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface px-3 py-2 text-sm"
              >
                <span className="flex items-center gap-2">
                  <Shield size={13} className="text-ink-faint" />
                  <code className="font-mono text-xs text-ink">{a.action}</code>
                  {a.entity && <span className="text-ink-faint">· {a.entity}</span>}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">
                  {fmt(a.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
