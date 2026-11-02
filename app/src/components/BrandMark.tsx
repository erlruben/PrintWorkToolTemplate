/** A compact print-sheet mark that works at sidebar and sign-in sizes. */
export default function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label="PrintFlow"
      style={{ display: 'block', flex: 'none' }}
    >
      <rect width="100" height="100" rx="24" fill="#202923" />
      <path d="M24 22h35l17 17v39H24z" fill="#fff" />
      <path d="M59 22v18h17" fill="#f3c7a8" />
      <path d="M36 51h29M36 63h22" fill="none" stroke="#d45d2a" strokeWidth="6" strokeLinecap="round" />
      <circle cx="69" cy="72" r="8" fill="#e2a84f" />
    </svg>
  );
}
