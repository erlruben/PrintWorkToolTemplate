/**
 * Files waiting for a Google sign-in. A browser only lets the sign-in pop-up
 * open straight from a click — not after the file window closes or a drop — so
 * when there is no Google pass yet, the upload waits here for one click.
 */
export default function DriveConnect({ count, onConnect, onCancel, busy }: {
  count: number;
  onConnect: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  return (
    <div className="drive-connect" role="status">
      <span>
        {count === 1 ? '1 file is' : `${count} files are`} ready to upload. Sign in to the company
        Google Drive first — it takes one click.
      </span>
      <span className="drive-connect-actions">
        <button type="button" className="btn sm" onClick={onConnect} disabled={busy}>
          {busy ? 'Connecting…' : 'Connect Google Drive & upload'}
        </button>
        <button type="button" className="linkbtn" onClick={onCancel} disabled={busy}>Cancel</button>
      </span>
    </div>
  );
}
