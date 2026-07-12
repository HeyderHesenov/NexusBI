import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Crown, History, LogOut, Pencil, Plus, Shield, Trash2, UserPlus, Users, X } from 'lucide-react'
import { useWorkspaceStore } from '../store/workspaceStore'
import { Field, FIELD, Select } from '../components/ui/form'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { Avatar } from '../components/ui/Avatar'
import { useFormatDate } from '../hooks/useFormatDate'

const ROLES = ['viewer', 'editor', 'owner']
// Owner is assigned only through the transfer flow (which also demotes the old owner).
const MEMBER_ROLES = ['viewer', 'editor']

export function WorkspacePage() {
  const { t } = useTranslation()
  const fmtDate = useFormatDate()
  // Audit timestamps without an explicit zone are UTC — mark them so before
  // formatting in the viewer's locale.
  const fmtAudit = (ts: string) =>
    fmtDate(/[zZ]|[+-]\d{2}:?\d{2}$/.test(ts) ? ts : `${ts}Z`, { mode: 'short' })
  const {
    workspaces, members, audit, load, create, remove, loadMembers, addMember, removeMember,
    rename, changeRole, transfer, leave, loadAudit,
  } = useWorkspaceStore()
  const [name, setName] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('viewer')
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [leaveId, setLeaveId] = useState<string | null>(null)
  const [renameId, setRenameId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [transferTarget, setTransferTarget] = useState<
    { wsId: string; memberId: string; email: string } | null
  >(null)

  useEffect(() => {
    load().catch(() => undefined)
    loadAudit().catch(() => undefined)
  }, [load, loadAudit])

  const toggle = (id: string) => {
    if (openId === id) return setOpenId(null)
    setOpenId(id)
    loadMembers(id).catch(() => undefined)
  }

  const startRename = (id: string, current: string) => {
    setRenameId(id)
    setRenameValue(current)
  }
  const submitRename = (id: string) => {
    if (renameValue.trim()) rename(id, renameValue.trim()).catch(() => undefined)
    setRenameId(null)
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

      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) {
            create(name.trim()).catch(() => undefined)
            setName('')
          }
        }}
        className="mb-6 rounded-2xl border border-line bg-surface p-5"
      >
        <p className="eyebrow mb-4">{t('workspacePage.newWorkspace')}</p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1">
            <Field id="ws-name" label={t('workspacePage.nameLabel')}>
              <input
                id="ws-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('workspacePage.newWorkspacePlaceholder')}
                className={FIELD}
              />
            </Field>
          </div>
          <button
            type="submit"
            disabled={!name.trim()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3.5 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press active:translate-y-px disabled:opacity-50"
          >
            <Plus size={15} /> {t('workspacePage.create')}
          </button>
        </div>
      </form>

      {workspaces.length === 0 ? (
        <div className="plot-grid grid min-h-[55vh] place-items-center rounded-2xl border border-dashed border-line px-6 py-12 text-center">
          <Users size={22} className="mx-auto text-ink-faint" />
          <p className="mt-2 font-display text-lg text-ink">{t('workspacePage.emptyWorkspaces')}</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {workspaces.map((w) => (
            <li key={w.id} className="rounded-2xl border border-line bg-surface p-4">
              <div className="flex items-center justify-between gap-3">
                {renameId === w.id ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault()
                      submitRename(w.id)
                    }}
                    className="flex flex-1 items-center gap-2"
                  >
                    <input
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      aria-label={t('workspacePage.rename')}
                      placeholder={t('workspacePage.renamePlaceholder')}
                      className={FIELD}
                    />
                    <button
                      type="submit"
                      title={t('workspacePage.save')}
                      aria-label={t('workspacePage.save')}
                      className="rounded-md border border-line p-1 text-accent transition hover:border-accent"
                    >
                      <Check size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setRenameId(null)}
                      aria-label={t('workspacePage.cancel')}
                      className="rounded-md border border-line p-1 text-ink-faint transition hover:text-ink"
                    >
                      <X size={14} />
                    </button>
                  </form>
                ) : (
                  <button onClick={() => toggle(w.id)} className="flex flex-1 items-center gap-2 text-left font-medium text-ink">
                    <Users size={16} className="text-accent" /> {w.name}
                  </button>
                )}
                <span className="flex shrink-0 items-center gap-2">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">
                    {t(`workspacePage.role_${w.role}`, w.role ?? '')}
                  </span>
                  {w.role === 'owner' && renameId !== w.id && (
                    <button
                      onClick={() => startRename(w.id, w.name)}
                      title={t('workspacePage.rename')}
                      aria-label={t('workspacePage.rename')}
                      className="rounded-md border border-line p-1 text-ink-faint transition hover:border-accent/50 hover:text-accent"
                    >
                      <Pencil size={13} />
                    </button>
                  )}
                  {w.role !== 'owner' && (
                    <button
                      onClick={() => setLeaveId(w.id)}
                      title={t('workspacePage.leave')}
                      aria-label={t('workspacePage.leave')}
                      className="rounded-md border border-line p-1 text-ink-faint transition hover:border-[#D87C6B]/50 hover:text-[#D87C6B]"
                    >
                      <LogOut size={13} />
                    </button>
                  )}
                  {w.role === 'owner' && (
                    <button
                      onClick={() => setDeleteId(w.id)}
                      title={t('workspacePage.deleteWorkspace')}
                      aria-label={t('workspacePage.deleteWorkspace')}
                      className="rounded-md border border-line p-1 text-ink-faint transition hover:border-[#D87C6B]/50 hover:text-[#D87C6B]"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </span>
              </div>

              {openId === w.id && (
                <div className="mt-3 space-y-2 border-t border-line pt-3">
                  {(members[w.id] ?? []).map((m) => {
                    const isOwnerRow = m.user_id === w.owner_id
                    const canManage = w.role === 'owner' && !isOwnerRow
                    return (
                      <div key={m.id} className="flex items-center justify-between gap-2 text-sm">
                        <span className="flex min-w-0 items-center gap-2">
                          <Avatar email={m.email} size="sm" />
                          <span className="truncate text-ink">{m.email}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          {canManage ? (
                            <Select
                              id={`ws-mrole-${m.id}`}
                              value={m.role}
                              onChange={(e) => changeRole(w.id, m.id, e.target.value).catch(() => undefined)}
                              options={MEMBER_ROLES.map((r) => ({
                                value: r,
                                label: t(`workspacePage.role_${r}`, r),
                              }))}
                            />
                          ) : (
                            <span className="rounded-md bg-surface-2 px-2 py-0.5 font-mono text-[10px] uppercase text-ink-soft">
                              {t(`workspacePage.role_${m.role}`, m.role ?? '')}
                            </span>
                          )}
                          {canManage && (
                            <>
                              <button
                                onClick={() => setTransferTarget({ wsId: w.id, memberId: m.id, email: m.email })}
                                title={t('workspacePage.transferOwnership')}
                                aria-label={t('workspacePage.transferOwnership')}
                                className="rounded-md border border-line p-1 text-ink-faint transition hover:border-accent/50 hover:text-accent"
                              >
                                <Crown size={13} />
                              </button>
                              <button
                                onClick={() => removeMember(w.id, m.id)}
                                aria-label={t('workspacePage.deleteWorkspace')}
                                className="rounded-md border border-line p-1 text-ink-faint transition hover:border-[#D87C6B]/50 hover:text-[#D87C6B]"
                              >
                                <Trash2 size={13} />
                              </button>
                            </>
                          )}
                        </span>
                      </div>
                    )
                  })}
                  {w.role === 'owner' && (
                    <>
                      <p className="pt-1 text-[11px] text-ink-faint">{t('workspacePage.editorHint')}</p>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault()
                          if (email.trim()) {
                            addMember(w.id, email.trim(), role).catch(() => undefined)
                            setEmail('')
                          }
                        }}
                        className="grid gap-3 pt-2 sm:grid-cols-[1fr_11rem_auto] sm:items-end"
                      >
                        <Field id={`ws-email-${w.id}`} label={t('workspacePage.memberEmailLabel')}>
                          <input
                            id={`ws-email-${w.id}`}
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder={t('workspacePage.memberEmailPlaceholder')}
                            className={FIELD}
                          />
                        </Field>
                        <Field id={`ws-role-${w.id}`} label={t('workspacePage.roleLabel')}>
                          <Select
                            id={`ws-role-${w.id}`}
                            value={role}
                            onChange={(e) => setRole(e.target.value)}
                            options={ROLES.map((r) => ({
                              value: r,
                              label: t(`workspacePage.role_${r}`, r),
                            }))}
                          />
                        </Field>
                        <button
                          type="submit"
                          disabled={!email.trim()}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-accent/40 bg-accent-soft px-3.5 py-2 text-sm font-semibold text-accent transition hover:border-accent disabled:opacity-50"
                        >
                          <UserPlus size={14} /> {t('workspacePage.addMember')}
                        </button>
                      </form>
                    </>
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
                  {fmtAudit(a.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={deleteId !== null}
        onClose={() => setDeleteId(null)}
        onConfirm={() => remove(deleteId!)}
        title={t('workspacePage.deleteTitle')}
        message={t('workspacePage.deleteConfirm', {
          name: workspaces.find((w) => w.id === deleteId)?.name ?? '',
        })}
      />

      <ConfirmDialog
        open={leaveId !== null}
        onClose={() => setLeaveId(null)}
        onConfirm={() => leave(leaveId!)}
        title={t('workspacePage.leave')}
        message={t('workspacePage.leaveConfirm', {
          name: workspaces.find((w) => w.id === leaveId)?.name ?? '',
        })}
      />

      <ConfirmDialog
        open={transferTarget !== null}
        onClose={() => setTransferTarget(null)}
        onConfirm={() => transfer(transferTarget!.wsId, transferTarget!.memberId)}
        title={t('workspacePage.transferOwnership')}
        message={t('workspacePage.transferConfirm', { email: transferTarget?.email ?? '' })}
      />
    </div>
  )
}
