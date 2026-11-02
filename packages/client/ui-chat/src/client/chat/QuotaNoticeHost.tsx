/**
 * The frame-wide `shell.overlay` host for quota notices. It holds the one live
 * notice for the whole app, so leaving the Chat panel does not drop it.
 */
import { IconWarningOutlineRegular, Toast } from '@liwa/client-ui-primitives'
import type { QuotaNoticeHostProps } from '../contract/slots.ts'

/**
 * @param props - the live notice, its dismissal, and the locale seat.
 * @returns the notice on display, or null while none is live.
 */
export function QuotaNoticeHost({ useNotice, dismissNotice, t }: QuotaNoticeHostProps) {
  const notice = useNotice(current => current)
  if (notice === null) return null
  return (
    <Toast
      key={`quota-notice-${String(notice.seq)}`}
      text={t('message.failure.quota')}
      icon={<IconWarningOutlineRegular size={18} />}
      onDone={dismissNotice}
    />
  )
}
