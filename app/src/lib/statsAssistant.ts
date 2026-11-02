/** The dashboard statistics assistant (2026-10-29). Like Chat Support, it is scripted and runs in the browser: it answers questions about the numbers on the person's own dashboard, in English or Filipino, and never sees anything their role cannot see. */
import type { ArtistStats, OperatorStats, ReceptionStats, SupplyStats } from "./dashboardStats";

export interface TeamRow { name: string; total: number; open: number; done: number }

/** What the assistant knows: the numbers on this person's dashboard. */
export type AskContext =
  | { role: "artist"; period: string; s: ArtistStats }
  | { role: "operator"; period: string; s: OperatorStats; printer: string }
  | { role: "reception"; s: ReceptionStats }
  | { role: "supply"; period: string; s: SupplyStats; stock: { name: string; site: string; quantity: number; unit: string }[] }
  | { role: "team"; period: string; inProgress: number; waiting: number; overdue: number; artists: TeamRow[]; printers: { name: string; printed: number }[] };

/** A question it can answer: shown as a suggestion chip (ask), found by its words (keys). */
export interface Intent<C> { id: string; ask: string; keys: string[]; reply: (c: C, q: string) => string }

export const norm = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function bestIntent<C>(question: string, intents: Intent<C>[]): Intent<C> | null {
  const q = ` ${norm(question)} `;
  let best: Intent<C> | null = null;
  let bestScore = 0;
  for (const intent of intents) {
    let score = 0;
    for (const key of intent.keys) {
      const nk = ` ${norm(key)} `;
      if (q.includes(nk)) score += key.length;
    }
    if (score > bestScore) {
      bestScore = score;
      best = intent;
    }
  }
  return bestScore > 0 ? best : null;
}

export const listOf = (names: string[]) => {
  const n = names.length;
  if (n === 0) return "";
  if (n === 1) return names[0];
  if (n === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[n - 1]}`;
};

type ArtistCtx = Extract<AskContext, { role: "artist" }>;
type OperatorCtx = Extract<AskContext, { role: "operator" }>;

const ARTIST: Intent<ArtistCtx>[] = [
  {
    id: "points",
    ask: "How many points do I have?",
    keys: ["points", "point", "credits", "score", "puntos", "ilan points"],
    reply: (c) => `You have ${plural(c.s.points, "point")} in the ${c.period}. You get 1 point for each file you add to a task.`
  },
  {
    id: "due",
    ask: "What is due soon?",
    keys: ["due", "deadline", "soon", "malapit", "due soon", "this week"],
    reply: (c) => c.s.dueSoon
      ? `${plural(c.s.dueSoon, "job")} due in the next 3 days.`
      : "Nothing is due in the next 3 days."
  },
  {
    id: "late",
    ask: "Am I late on anything?",
    keys: ["late", "overdue", "past due", "huli", "lagpas"],
    reply: (c) => c.s.overdue
      ? `${plural(c.s.overdue, "job")} past the due date. Start with those.`
      : "Nothing is past its due date. Nice."
  },
  {
    id: "open",
    ask: "How many jobs do I have?",
    keys: ["jobs", "tasks", "open", "work", "trabaho", "gagawin", "how many"],
    reply: (c) => `${plural(c.s.todo, "job")} to do and ${c.s.inProgress} in progress.`
  },
  {
    id: "next",
    ask: "What should I work on next?",
    keys: ["next", "first", "susunod", "uunahin", "priority"],
    reply: (c) => {
      const j = c.s.jobs[0];
      return j
        ? `Start with ${j.wo_number} for ${j.client_name}${j.date_due ? `, due ${j.date_due}` : ""}.`
        : "You have no open jobs right now.";
    }
  }
];

const OPERATOR: Intent<OperatorCtx>[] = [
  {
    id: "points",
    ask: "How many jobs have I printed?",
    keys: ["points", "printed", "credits", "done", "natapos", "na print"],
    reply: (c) => `You printed ${plural(c.s.points, "job")} in the ${c.period}. Each printed job is 1 point.`
  },
  {
    id: "queue",
    ask: "What is waiting for me?",
    keys: ["waiting", "queue", "pila", "naghihintay", "how many"],
    reply: (c) => `${plural(c.s.waiting, "job")} waiting and ${c.s.printing} printing now.`
  },
  {
    id: "printer",
    ask: "How is my printer?",
    keys: ["printer", "machine", "broken", "sira", "status"],
    reply: (c) => `Your printer is ${c.printer.toLowerCase()}.`
  },
  {
    id: "next",
    ask: "What do I print next?",
    keys: ["next", "first", "susunod", "uunahin"],
    reply: (c) => {
      const j = c.s.queue[0];
      return j
        ? `Next is ${j.wo_number} for ${j.client_name}.`
        : "Your queue is empty.";
    }
  }
];

type ReceptionCtx = Extract<AskContext, { role: "reception" }>;
type SupplyCtx = Extract<AskContext, { role: "supply" }>;
const RECEPTION: Intent<ReceptionCtx>[] = [
  {
    id: "today",
    ask: "How many jobs came in today?",
    keys: ["today","new","ngayon","came in","bago"],
    reply: (c) => `${plural(c.s.openedToday, "new job")} today.`,
  },
  {
    id: "ready",
    ask: "What is ready to release?",
    keys: ["ready","release","pickup","pick up","kukunin","claim"],
    reply: (c) => `${plural(c.s.readyForRelease, "job")} ready to hand over.`,
  },
  {
    id: "client",
    ask: "What is waiting on the client?",
    keys: ["client","customer","approval","payment","kliyente","waiting"],
    reply: (c) => `${plural(c.s.waitingOnClient, "job")} waiting on the client.`,
  },
  {
    id: "late",
    ask: "What is past due?",
    keys: ["late","overdue","past due","huli"],
    reply: (c) => c.s.overdue ? `${plural(c.s.overdue, "job")} past the due date.` : "Nothing is past due.",
  },
];
const SUPPLY: Intent<SupplyCtx>[] = [
  {
    id: "low",
    ask: "What is running low?",
    keys: ["low","running low","reorder","ubos","kulang","order"],
    reply: (c) => c.s.low.length === 0 ? "Everything is above its reorder level." : `Running low: ${listOf(c.s.low.map((l) => `${l.item.name} (${l.site}, ${l.quantity} ${l.item.unit})`))}.`,
  },
  {
    id: "item",
    ask: "How much tarpaulin do we have?",
    keys: ["how much","ilan","stock","left","natitira","meron pa"],
    reply: (c, q) => { const words = norm(q).split(" "); const rows = c.stock.filter((r) => norm(r.name).split(" ").some((w) => w.length > 3 && words.includes(w))); return rows.length === 0 ? "Tell me the item name, for example: how much ink is left?" : `${listOf(rows.map((r) => `${r.name}, ${r.site}: ${r.quantity} ${r.unit}`))}.`; },
  },
  {
    id: "moves",
    ask: "What came in and what was used?",
    keys: ["received","used","usage","delivery","dumating","nagamit"],
    reply: (c) => `In the ${c.period}: ${c.s.received} received and ${c.s.used} used.`,
  },
];

type TeamCtx = Extract<AskContext, { role: "team" }>;
const TEAM: Intent<TeamCtx>[] = [
  {
    id: "busiest",
    ask: "Who has the most jobs?",
    keys: ["most","busiest","who","pinakamarami","sino","artist"],
    reply: (c) => {
      const top = [...c.artists].sort((a, b) => b.total - a.total)[0];
      return !top || top.total === 0 ? "No artist has work in this period." : `${top.name} has the most: ${plural(top.total, "job")}, ${top.open} in progress.`;
    }
  },
  {
    id: "printing",
    ask: "Who printed the most?",
    keys: ["printed","printer","operator","print"],
    reply: (c) => {
      const top = [...c.printers].sort((a, b) => b.printed - a.printed)[0];
      return !top || top.printed === 0 ? "Nothing printed in this period." : `${top.name} printed the most: ${plural(top.printed, "job")}.`;
    }
  },
  {
    id: "late",
    ask: "What is late?",
    keys: ["late","overdue","past due","huli"],
    reply: (c) => `${plural(c.overdue, "job")} past the due date.`
  },
  {
    id: "now",
    ask: "How busy are we right now?",
    keys: ["now","busy","status","ngayon","today"],
    reply: (c) => `${c.inProgress} in progress and ${c.waiting} waiting to print.`
  }
];

export interface AskReply {
  text: string;
  understood: boolean;
}

export function suggestions(c: AskContext): string[] {
  switch (c.role) {
    case "artist":
      return ARTIST.map(i => i.ask);
    case "operator":
      return OPERATOR.map(i => i.ask);
    case "reception":
      return RECEPTION.map(i => i.ask);
    case "supply":
      return SUPPLY.map(i => i.ask);
    case "team":
      return TEAM.map(i => i.ask);
    default:
      return [];
  }
}

export function answer(question: string, c: AskContext): AskReply {
  switch (c.role) {
    case "artist":
      {
        const i = bestIntent(question, ARTIST);
        return i ? { text: i.reply(c, question), understood: true } : { text: `I can answer questions like: ${suggestions(c).slice(0, 3).join(" ")}`, understood: false };
      }
    case "operator":
      {
        const i = bestIntent(question, OPERATOR);
        return i ? { text: i.reply(c, question), understood: true } : { text: `I can answer questions like: ${suggestions(c).slice(0, 3).join(" ")}`, understood: false };
      }
    case "reception":
      {
        const i = bestIntent(question, RECEPTION);
        return i ? { text: i.reply(c, question), understood: true } : { text: `I can answer questions like: ${suggestions(c).slice(0, 3).join(" ")}`, understood: false };
      }
    case "supply":
      {
        const i = bestIntent(question, SUPPLY);
        return i ? { text: i.reply(c, question), understood: true } : { text: `I can answer questions like: ${suggestions(c).slice(0, 3).join(" ")}`, understood: false };
      }
    case "team":
      {
        const i = bestIntent(question, TEAM);
        return i ? { text: i.reply(c, question), understood: true } : { text: `I can answer questions like: ${suggestions(c).slice(0, 3).join(" ")}`, understood: false };
      }
    default:
      return { text: `I can answer questions like: ${suggestions(c).slice(0, 3).join(" ")}`, understood: false };
  }
}
