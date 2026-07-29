import { useTranslation } from 'react-i18next'
import { useChatUnreadStore } from '../../store/chatUnreadStore'

/** Unread count on the Sidebar's chat item.
 *
 * A leaf on purpose: this is the ONLY component subscribed to unread state, so a
 * message arriving re-renders one <span> rather than the whole Sidebar (which
 * re-runs sources.find() and 18 function-as-child NavLinks on every render).
 * The selector must stay a primitive — zustand v5 dropped the equalityFn arg, so
 * `s => s.rooms` would re-render on every frame, including other rooms'. */
export function ChatNavBadge() {
  const { t } = useTranslation()
  const total = useChatUnreadStore((s) => s.total())
  if (total <= 0) return null
  return (
    <span
      aria-label={t('nav.chatUnread', { count: total })}
      className="ml-auto grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-full bg-accent px-1 text-[10px] font-bold text-bg"
    >
      {total > 99 ? '99+' : total}
    </span>
  )
}
