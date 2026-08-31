export function ConfirmModal({
  title,
  body,
  confirmLabel,
  busy,
  onCancel,
  onConfirm,
}: {
  title: string
  body: string
  confirmLabel: string
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="modal-back" role="dialog" aria-modal="true">
      <div className="modal">
        <h3>{title}</h3>
        <p>{body}</p>
        <div className="modal-actions">
          <button className="btn" type="button" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="btn danger" type="button" onClick={onConfirm} disabled={busy}>
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
