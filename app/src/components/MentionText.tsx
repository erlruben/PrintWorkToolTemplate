import { parseBody } from '../lib/mentions';

/**
 * Renders a message body, turning `@[Name](id)` tokens into highlighted @Name
 * chips. The one aimed at the reader is called out extra. The surrounding
 * bubble keeps `white-space: pre-wrap`, so plain text keeps its line breaks.
 */
export default function MentionText({ body, meId }: { body: string; meId?: string }) {
  return (
    <>
      {parseBody(body).map((p, i) =>
        'text' in p ? (
          p.text
        ) : (
          <span key={i} className={`mention${p.id === meId || (!!meId && p.ids?.includes(meId)) ? ' me' : ''}`}>@{p.name}</span>
        ),
      )}
    </>
  );
}
