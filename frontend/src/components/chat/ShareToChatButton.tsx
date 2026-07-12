import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { Hash, Share2 } from 'lucide-react'
import * as chatApi from '../../api/chat'
import type { Channel, DMPeer, ShareResourceType } from '../../api/chat'
import { useAuthStore } from '../../store/authStore'
import { useWorkspaceStore } from '../../store/workspaceStore'
import { Avatar } from '../ui/Avatar'
import { Field, FIELD, Select } from '../ui/form'
import { ModalShell } from '../ui/ModalShell'

interface Props {
  resourceType: ShareResourceType
  resourceId: string
  /** Trigger chrome — one shared recipe per host context, no per-page strings. */
  variant?: keyof typeof VARIANTS
  /** Visible label next to the icon (the labelled `header` variant). */
  label?: string
  iconSize?: number
}

const VARIANTS = {
  /** Bordered icon chip — inline action rows (contracts, decisions, metrics, reports). */
  chip: 'rounded-lg border border-line p-1.5 text-ink-soft transition hover:border-accent hover:text-accent',
  /** Borderless hover-reveal row action (SavedCard lists). */
  row: 'rounded-md p-1 text-ink-faint transition hover:text-accent',
  /** Table-row icon button (history explorer). */
  list: 'rounded-md p-1.5 text-ink-faint transition hover:bg-surface hover:text-accent',
  /** Labelled page-header button (dashboard toolbar). */
  header:
    'rounded-xl border border-line px-4 py-2 text-sm font-medium text-ink-soft transition hover:border-accent hover:text-ink',
}

/** "Çata paylaş" trigger + room-picker dialog. Lists the user's workspace
 * channels and DM peers, takes an optional caption, then POSTs /chat/share —
 * the server builds the card, so any artifact page can drop this in with just
 * a resource type + id. */
export function ShareToChatButton({
  resourceType,
  resourceId,
  variant = 'chip',
  label,
  iconSize = 15,
}: Props) {
  const { t } = useTranslation()
  const userId = useAuthStore((s) => s.user?.id)
  const { workspaces, load: loadWorkspaces } = useWorkspaceStore()

  const [open, setOpen] = useState(false)
  const [wsId, setWsId] = useState('')
  const [channels, setChannels] = useState<Channel[]>([])
  const [peers, setPeers] = useState<DMPeer[]>([])
  const [roomKey, setRoomKey] = useState('')
  const [caption, setCaption] = useState('')
  const [busy, setBusy] = useState(false)

  // Selected workspace, derived — first workspace until the user picks one.
  const activeWs = wsId || (workspaces[0]?.id ?? '')

  // Fetch locally on open — going through chatStore would clobber an open room.
  useEffect(() => {
    if (!open) return
    if (workspaces.length === 0) loadWorkspaces().catch(() => undefined)
    chatApi
      .dmPeers()
      .then(setPeers)
      .catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open || !activeWs) return
    chatApi
      .listChannels(activeWs)
      .then(setChannels)
      .catch(() => setChannels([]))
  }, [open, activeWs])

  const close = () => {
    setOpen(false)
    setRoomKey('')
    setCaption('')
  }

  const share = async () => {
    if (!roomKey) return
    setBusy(true)
    try {
      await chatApi.shareToChat({
        room_key: roomKey,
        resource_type: resourceType,
        resource_id: resourceId,
        caption: caption.trim(),
      })
      toast.success(t('shareDialog.shared'))
      close()
    } catch {
      /* interceptor toast */
    } finally {
      setBusy(false)
    }
  }

  const roomRow = (key: string, avatar: React.ReactNode, name: string) => (
    <li key={key}>
      <button
        type="button"
        onClick={() => setRoomKey(key)}
        aria-pressed={roomKey === key}
        className={`flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition ${
          roomKey === key
            ? 'border-accent bg-accent-soft'
            : 'border-transparent hover:bg-surface-2'
        }`}
      >
        {avatar}
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{name}</span>
      </button>
    </li>
  )

  const noRooms = channels.length === 0 && peers.length === 0

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t('shareDialog.title')}
        aria-label={t('shareDialog.title')}
        className={VARIANTS[variant]}
      >
        <span className="flex items-center gap-1.5">
          <Share2 size={iconSize} />
          {label}
        </span>
      </button>

      <ModalShell
        open={open}
        onClose={close}
        title={t('shareDialog.title')}
        subtitle={t('shareDialog.subtitle')}
        footer={
          <div className="flex justify-end gap-2">
            <button
              onClick={close}
              className="rounded-xl px-4 py-2 text-sm text-ink-soft transition hover:text-ink"
            >
              {t('shareDialog.cancel')}
            </button>
            <button
              onClick={share}
              disabled={!roomKey || busy}
              className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press disabled:opacity-50"
            >
              {busy ? t('shareDialog.sharing') : t('shareDialog.share')}
            </button>
          </div>
        }
      >
        <div className="space-y-3 p-5">
          {workspaces.length > 1 && (
            <Field id="share-ws" label={t('chatPage.workspace')}>
              <Select
                id="share-ws"
                value={activeWs}
                onChange={(e) => {
                  setWsId(e.target.value)
                  setRoomKey('')
                }}
                options={workspaces.map((w) => ({ value: w.id, label: w.name }))}
              />
            </Field>
          )}

          {noRooms ? (
            <p className="py-4 text-center text-sm text-ink-faint">{t('shareDialog.empty')}</p>
          ) : (
            <>
              {channels.length > 0 && (
                <div>
                  <p className="eyebrow mb-1.5">{t('chatPage.channels')}</p>
                  <ul className="space-y-0.5">
                    {channels.map((c) =>
                      roomRow(
                        chatApi.channelRoom(c.workspace_id, c.id),
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-2 text-ink-faint">
                          <Hash size={14} />
                        </span>,
                        c.name,
                      ),
                    )}
                  </ul>
                </div>
              )}
              {peers.length > 0 && userId && (
                <div>
                  <p className="eyebrow mb-1.5">{t('chatPage.directMessages')}</p>
                  <ul className="space-y-0.5">
                    {peers.map((p) =>
                      roomRow(
                        chatApi.dmRoom(userId, p.user_id),
                        <Avatar
                          name={p.full_name}
                          email={p.email}
                          size="sm"
                          colorSeed={p.user_id}
                        />,
                        p.full_name || p.email,
                      ),
                    )}
                  </ul>
                </div>
              )}
            </>
          )}

          <Field id="share-caption" label={t('shareDialog.captionLabel')}>
            <input
              id="share-caption"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              maxLength={500}
              placeholder={t('shareDialog.captionPlaceholder')}
              className={FIELD}
            />
          </Field>
        </div>
      </ModalShell>
    </>
  )
}
