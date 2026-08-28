import { useEffect, type JSX } from 'react';
import { actions, selectNotices, useStore } from '@/state/store';

/**
 * Toasts announce themselves and leave on their own; nobody should have to
 * chase ✕ buttons on a communication device. Errors linger longest so there
 * is time to actually read them; the ✕ remains for dismissing early.
 */
const NOTICE_LIFETIME_MS = { info: 5000, warning: 8000, error: 12000 } as const;

function Notice({
  notice,
}: {
  notice: { id: string; level: 'info' | 'warning' | 'error'; text: string };
}): JSX.Element {
  useEffect(() => {
    const timer = window.setTimeout(
      () => actions.dismissNotice(notice.id),
      NOTICE_LIFETIME_MS[notice.level],
    );
    return () => window.clearTimeout(timer);
  }, [notice.id, notice.level]);

  return (
    <div className={`notice notice--${notice.level}`} role="status">
      <p className="notice__text">{notice.text}</p>
      <button
        type="button"
        className="button button--ghost"
        style={{ minHeight: 'auto', padding: '0 0.5rem' }}
        aria-label="Dismiss notification"
        onClick={() => actions.dismissNotice(notice.id)}
      >
        ✕
      </button>
    </div>
  );
}

export function NoticeStack(): JSX.Element | null {
  const notices = useStore(selectNotices);
  if (notices.length === 0) return null;

  return (
    <div className="notices" aria-live="assertive" aria-atomic="false">
      {notices.map((notice) => (
        <Notice key={notice.id} notice={notice} />
      ))}
    </div>
  );
}
