// "Ask about the numbers" on each dashboard: suggestion chips and a question box, answered in the browser from this dashboard's own figures (lib/statsAssistant).
import { useState, type FormEvent } from "react";
import { answer, suggestions, type AskContext } from "../lib/statsAssistant";

export default function StatsAsk({ context }: { context: AskContext }) {
  const [q, setQ] = useState<string>("");
  const [log, setLog] = useState<Array<{ q: string; a: string }>>([]);

  function ask(question: string): void {
    const t = question.trim();
    if (!t) return;
    setLog((l) => [...l.slice(-4), { q: t, a: answer(t, context).text }]);
    setQ("");
  }

  function onSubmit(e: FormEvent): void {
    e.preventDefault();
    ask(q);
  }

  return (
    <div className="wl-card wl-ask">
      <div className="wl-card-head">
        <h2>Ask about the numbers</h2>
        <span className="wl-card-note">Answers from this dashboard · works offline</span>
      </div>
      {log.length > 0 && (
        <ul className="wl-ask-log" aria-live="polite">
          {log.map((m, i) => (
            <li key={i}>
              <p className="wl-ask-q">{m.q}</p>
              <p className="wl-ask-a">{m.a}</p>
            </li>
          ))}
        </ul>
      )}
      <div className="wl-ask-chips">
        {suggestions(context).map((s) => (
          <button key={s} type="button" onClick={() => ask(s)}>
            {s}
          </button>
        ))}
      </div>
      <form className="wl-ask-form" onSubmit={onSubmit}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Type a question, e.g. ilan points ko?"
          aria-label="Question about these numbers"
        />
        <button type="submit" className="btn" disabled={!q.trim()}>
          Ask
        </button>
      </form>
    </div>
  );
}
