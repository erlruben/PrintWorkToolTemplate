export default function MadeBy({ tone = 'dark' }: { tone?: 'dark' | 'light' }) {
  return (
    <div className={`made-by ${tone}`}>
      <span className="mb-label">Built by</span>
      <img className="mb-mark" src="/brand/recon-mark.png" alt="" />
      <span className="mb-name">RECONTECH</span>
    </div>
  );
}
