/**
 * Shown when a notification points at a task that is no longer there — it was
 * deleted, or moved to the Trash (049).
 */
export default function MissingTask({ inTrash, onClose }: { inTrash: boolean; onClose: () => void }) {
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet missing-task" role="alertdialog" aria-labelledby="missing-task-title">
        <div className="missing-task-body">
          <h2 id="missing-task-title">Task not found</h2>
          <p>
            {inTrash
              ? 'This task was moved to the Trash. Open the Trash Bin from your profile menu to restore it.'
              : 'This task no longer exists — it may have been deleted.'}
          </p>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" autoFocus onClick={onClose}>OK</button>
          </div>
        </div>
      </div>
    </div>
  );
}
