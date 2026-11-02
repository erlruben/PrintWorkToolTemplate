import { useEffect, useRef, useState } from 'react';
import type { AwaitingJob } from '../lib/data';
import { audioBlocked, playPrintAlert, playTimerDoneAlert, unlockAudio } from '../lib/sound';
import type { Site } from '../lib/types';
import { IconMonitor } from './Icons';

const REPEAT_MS = 20_000;          // ring again every 20 seconds…
const GIVE_UP_MS = 10 * 60_000;    // …for up to 10 minutes, or until someone taps
const TIMER_REPEAT_MS = 30_000;    // "printing time is up": again every 30 seconds…
const TIMER_GIVE_UP_MS = 5 * 60_000; // …for up to 5 minutes, or until someone taps
const TIMER_LATE_MS = 15 * 60_000; // a timer that ran out longer ago than this (screen was off) is not rung

/**
 * The operator's print alarm, on every screen of the app. When a file lands in
 * their printing area's queue it plays the alarm twice, then says "A new task
 * is in Print Queue", and repeats every 20 seconds until someone taps or presses
 * a key. A red banner shows which job arrived and opens the queue. Browsers hold
 * sound back until the page has been tapped once, so if that's the case a
 * banner asks for one tap first.
 */
export default function PrintAlarm({
  jobs,
  site,
  me,
  isOperator,
  onOpenQueue,
}: {
  jobs: AwaitingJob[] | null;
  site: Site | null;
  me: string;
  isOperator: boolean;
  onOpenQueue: () => void;
}) {
  const [ringing, setRinging] = useState<string[]>([]);     // WO numbers that just arrived
  const [timeUp, setTimeUp] = useState<string[]>([]);       // WO numbers whose printer timer ran out
  const [blocked, setBlocked] = useState(false);
  const seen = useRef<Set<string> | null>(null);

  // Jobs for this operator's area (jobs with no area go to everyone).
  const mine = jobs?.filter((j) => !site || j.target_site === null || j.target_site === site) ?? null;
  const key = mine ? mine.map((j) => j.id).sort().join('|') : null;

  // A job appearing (not the first load) starts the alarm; a job leaving the
  // queue (someone picked it up) drops it from the banner.
  useEffect(() => {
    if (!mine) return;
    const fresh = seen.current ? mine.filter((j) => !seen.current!.has(j.id)) : [];
    seen.current = new Set(mine.map((j) => j.id));
    if (fresh.length) {
      setRinging((r) => [...new Set([...r, ...fresh.map((j) => j.wo_number)])]);
    } else {
      setRinging((r) => r.filter((wo) => mine.some((j) => j.wo_number === wo)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // While ringing: alert now and every 20s; any tap or key press stops it.
  const on = ringing.length > 0;
  useEffect(() => {
    if (!on) return;
    let stopSound = playPrintAlert();
    const started = Date.now();
    const t = window.setInterval(() => {
      if (Date.now() - started > GIVE_UP_MS) { window.clearInterval(t); return; }
      stopSound = playPrintAlert();
    }, REPEAT_MS);
    // A tap on the banner itself is left to its button (which also stops the
    // alarm) — stopping on pointerdown would remove the button before its click.
    const ack = (e: Event) => {
      if (e.target instanceof Element && e.target.closest('.print-alarm')) return;
      setRinging([]);
    };
    window.addEventListener('pointerdown', ack);
    window.addEventListener('keydown', ack);
    return () => {
      window.clearInterval(t);
      stopSound();
      window.removeEventListener('pointerdown', ack);
      window.removeEventListener('keydown', ack);
    };
  }, [on]);

  // The printer timer on a job ran out: ring the operator who has it — or every
  // operator in the area when nobody has claimed it; a shop PC with the alarm
  // switched on hears every job. Each timer rings once (a new timer can ring again).
  const timers = (mine ?? []).filter((j) => j.print_eta && j.print_state !== 'paused'
    && (!isOperator || !j.operator_id || j.operator_id === me));
  const timerKey = timers.map((j) => `${j.id}|${j.print_eta}`).sort().join(',');
  const rung = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!timers.length) return;
    const check = () => {
      const now = Date.now();
      const up = timers.filter((j) => {
        const end = Date.parse(j.print_eta!);
        const k = `${j.id}|${j.print_eta}`;
        if (end > now || rung.current.has(k)) return false;
        rung.current.add(k);
        return now - end < TIMER_LATE_MS;
      });
      if (up.length) setTimeUp((t) => [...new Set([...t, ...up.map((j) => j.wo_number)])]);
    };
    check();
    const t = window.setInterval(check, 1000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timerKey]);
  // A job that was finished, paused or taken off the queue drops off the banner.
  useEffect(() => {
    setTimeUp((t) => t.filter((wo) => timers.some((j) => j.wo_number === wo)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timerKey]);

  const timeUpOn = timeUp.length > 0;
  const firstUp = timeUp[0];
  useEffect(() => {
    if (!timeUpOn || !firstUp) return;
    let stopSound = playTimerDoneAlert(firstUp);
    const started = Date.now();
    const t = window.setInterval(() => {
      if (Date.now() - started > TIMER_GIVE_UP_MS) { window.clearInterval(t); return; }
      stopSound = playTimerDoneAlert(firstUp);
    }, TIMER_REPEAT_MS);
    const ack = (e: Event) => {
      if (e.target instanceof Element && e.target.closest('.print-alarm')) return;
      setTimeUp([]);
    };
    window.addEventListener('pointerdown', ack);
    window.addEventListener('keydown', ack);
    return () => {
      window.clearInterval(t);
      stopSound();
      window.removeEventListener('pointerdown', ack);
      window.removeEventListener('keydown', ack);
    };
  }, [timeUpOn, firstUp]);

  // Is the browser holding sound back? Check once the page has settled, and
  // unlock on the first tap or key press.
  useEffect(() => {
    const check = window.setTimeout(() => setBlocked(audioBlocked()), 1500);
    const unlock = () => {
      unlockAudio().then((ok) => {
        setBlocked(!ok);
        if (ok) {
          window.removeEventListener('pointerdown', unlock);
          window.removeEventListener('keydown', unlock);
        }
      });
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.clearTimeout(check);
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  if (!on && !blocked && !timeUpOn) return null;
  return (
    <div className="print-alarm-stack">
      {timeUpOn && (
        <div className="print-alarm time-up" role="alert">
          <span className="print-alarm-icon" aria-hidden>⏰</span>
          <span className="print-alarm-main">
            <strong>Printing time is up — {timeUp.slice(0, 3).join(', ')}{timeUp.length > 3 ? '…' : ''}</strong>
            <span>Check the printer, then Finish it or set more time. Tap anywhere to stop the alarm.</span>
          </span>
          <button className="btn sm" onClick={() => { setTimeUp([]); onOpenQueue(); }}>
            Open Print Queue
          </button>
        </div>
      )}
      {on && (
        <div className="print-alarm" role="alert">
          <span className="print-alarm-icon" aria-hidden><IconMonitor /></span>
          <span className="print-alarm-main">
            <strong>New file to print — {ringing.slice(0, 3).join(', ')}{ringing.length > 3 ? '…' : ''}</strong>
            <span>Tap anywhere to stop the alarm.</span>
          </span>
          <button className="btn sm" onClick={() => { setRinging([]); onOpenQueue(); }}>
            Open Print Queue
          </button>
        </div>
      )}
      {blocked && !on && !timeUpOn && (
        <button type="button" className="print-alarm-sound" onClick={() => unlockAudio().then((ok) => setBlocked(!ok))}>
          <span className="print-alarm-sound-icon" aria-hidden>🔇</span>
          Tap here once to turn on the print alarm sound
        </button>
      )}
    </div>
  );
}
