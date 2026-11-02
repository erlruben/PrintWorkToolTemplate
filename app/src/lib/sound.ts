// Notification sounds, per device: an on/off mute plus a volume level. The
// chimes (bell, print queue, chat) all scale their gain by effectiveVolume()
// before playing, and both settings live in localStorage. On and full volume
// with nothing saved. Changes broadcast a 'soundchange' event so an open
// Settings panel and the players stay in step within the same tab.

import { useEffect, useState } from 'react';

const ON_KEY = 'printflow-soundOn';
const VOL_KEY = 'printflow-soundVolume';

export function isSoundOn(): boolean {
  try {
    return localStorage.getItem(ON_KEY) !== 'off';
  } catch {
    return true; // storage blocked — default to audible
  }
}

export function setSoundOn(on: boolean) {
  try { localStorage.setItem(ON_KEY, on ? 'on' : 'off'); } catch { /* ignore */ }
  window.dispatchEvent(new Event('soundchange'));
}

export function getVolume(): number {
  try {
    const v = parseFloat(localStorage.getItem(VOL_KEY) ?? '');
    if (Number.isFinite(v) && v >= 0 && v <= 1) return v;
  } catch { /* ignore */ }
  return 1;
}

export function setVolume(v: number) {
  const clamped = Math.min(1, Math.max(0, v));
  try { localStorage.setItem(VOL_KEY, String(clamped)); } catch { /* ignore */ }
  window.dispatchEvent(new Event('soundchange'));
}

// The multiplier the players apply to their base gain: 0 when muted.
export function effectiveVolume(): number {
  return isSoundOn() ? getVolume() : 0;
}

// A short beep at the current level, so the volume slider is audible as it moves.
export function playTestSound() {
  const vol = effectiveVolume();
  if (vol <= 0) return;
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.12 * vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch { /* audio blocked until the page is interacted with */ }
}

// One shared audio context for the print alarm. Browsers start audio (and
// speech) "suspended" until the page has been tapped or clicked once — a real
// problem for a screen left open at the printers after a reload. unlockAudio()
// runs on the first tap; audioBlocked() lets the UI ask for that tap.
let alarmCtx: AudioContext | null = null;
function alarmContext(): AudioContext | null {
  if (alarmCtx) return alarmCtx;
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    alarmCtx = new Ctx();
  } catch { alarmCtx = null; }
  return alarmCtx;
}

/** True while the browser is still holding sound back until a tap. */
export function audioBlocked(): boolean {
  const c = alarmContext();
  return !!c && c.state !== 'running';
}

/** Call from a tap/keypress: lets the alarm (and the spoken announcement) play. */
export async function unlockAudio(): Promise<boolean> {
  const c = alarmContext();
  try {
    // A silent utterance inside the tap unlocks speech too (needed on iPhone).
    if ('speechSynthesis' in window && !speechPrimed) {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      window.speechSynthesis.speak(u);
      speechPrimed = true;
    }
    if (c && c.state !== 'running') await c.resume();
  } catch { /* ignore */ }
  return !c || c.state === 'running';
}
let speechPrimed = false;

/**
 * The print-queue alarm — a loud, two-tone square-wave "da-DING" three times,
 * on purpose unlike the gentle chimes elsewhere, so operators learn this exact
 * sound means "a file just arrived to print." About 1.7s. Scales with volume.
 */
export function playPrintAlarm() {
  const vol = effectiveVolume();
  if (vol <= 0) return;
  const ctx = alarmContext();
  if (!ctx) return;
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
  try {
    const now = ctx.currentTime;
    [0, 0.6, 1.2].forEach((base) => {
      ([[0, 880], [0.18, 1318.5]] as const).forEach(([off, freq]) => {
        const t = now + base + off;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.55 * vol, t + 0.01);
        gain.gain.setValueAtTime(0.55 * vol, t + 0.14);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.28);
      });
    });
  } catch { /* audio unavailable; the banner and flash carry it */ }
}

const ALARM_MS = 1700;
export const PRINT_ANNOUNCEMENT = 'A new task is in Print Queue';

/** Say something in a clear English voice, at the notification volume. */
function speak(text: string) {
  const vol = effectiveVolume();
  if (vol <= 0 || !('speechSynthesis' in window)) return;
  try {
    const voices = window.speechSynthesis.getVoices();
    const u = new SpeechSynthesisUtterance(text);
    u.voice = voices.find((v) => /^en[-_](US|GB|PH|AU)/i.test(v.lang)) ?? voices.find((v) => /^en/i.test(v.lang)) ?? null;
    u.lang = u.voice?.lang ?? 'en-US';
    u.rate = 0.95;
    u.volume = vol;
    window.speechSynthesis.cancel();              // never build a backlog of announcements
    window.speechSynthesis.speak(u);
  } catch { /* speech unavailable — the alarm and banner still work */ }
}

// The alarm beeps can be switched off per device, leaving just the voice.
const BEEP_KEY = 'printAlarmBeep';
export function isAlarmBeepOn(): boolean {
  try { return localStorage.getItem(BEEP_KEY) !== 'off'; } catch { return true; }
}
export function setAlarmBeepOn(on: boolean) {
  try { localStorage.setItem(BEEP_KEY, on ? 'on' : 'off'); } catch { /* ignore */ }
  window.dispatchEvent(new Event('soundchange'));
}
export function useAlarmBeep(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState<boolean>(isAlarmBeepOn);
  useEffect(() => {
    const sync = () => setOn(isAlarmBeepOn());
    window.addEventListener('soundchange', sync);
    return () => window.removeEventListener('soundchange', sync);
  }, []);
  return [on, setAlarmBeepOn];
}

/**
 * The full "new print job" alert: the alarm, the alarm again, then a voice
 * saying "A new task is in Print Queue" — or just the voice when the beeps are
 * switched off on this device. Returns a stop() that cancels whatever hasn't
 * played yet.
 */
export function playPrintAlert(): () => void {
  const beeps = isAlarmBeepOn();
  if (beeps) playPrintAlarm();
  const timers = beeps
    ? [
        window.setTimeout(playPrintAlarm, ALARM_MS + 200),
        window.setTimeout(() => speak(PRINT_ANNOUNCEMENT), ALARM_MS * 2 + 500),
      ]
    : [window.setTimeout(() => speak(PRINT_ANNOUNCEMENT), 150)];
  return () => {
    timers.forEach((t) => window.clearTimeout(t));
    try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
  };
}

/**
 * "Printing time is up" — the printer timer on a job reached zero. A falling
 * three-note chime (unlike the new-job buzzer), then a voice naming the job.
 * Returns a stop().
 */
export function playTimerDoneAlert(wo: string): () => void {
  const vol = effectiveVolume();
  const ctx = alarmContext();
  if (ctx && vol > 0) {
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    try {
      const now = ctx.currentTime;
      [0, 0.75].forEach((base) => {
        ([[0, 1318.5], [0.22, 1046.5], [0.44, 784]] as const).forEach(([off, freq]) => {
          const t = now + base + off;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(0.0001, t);
          gain.gain.exponentialRampToValueAtTime(0.7 * vol, t + 0.01);
          gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
          osc.connect(gain).connect(ctx.destination);
          osc.start(t);
          osc.stop(t + 0.32);
        });
      });
    } catch { /* audio unavailable; the banner carries it */ }
  }
  // Read the code letter by letter so it is clear over the press: "W O, X 2 Y P B".
  const spoken = wo.replace(/^WO-?/i, '').split('').join(' ');
  const t = window.setTimeout(() => speak(`Printing time is up for W O ${spoken}`), 1700);
  return () => { window.clearTimeout(t); try { window.speechSynthesis?.cancel(); } catch { /* ignore */ } };
}

// Operators always get the print alarm. Anyone else can turn it on for one
// device — a PC at the printing area, or to try it out. Remembered per device.
const ALARM_HERE_KEY = 'printAlarmHere';
export function isPrintAlarmHere(): boolean {
  try { return localStorage.getItem(ALARM_HERE_KEY) === 'on'; } catch { return false; }
}
export function setPrintAlarmHere(on: boolean) {
  try { localStorage.setItem(ALARM_HERE_KEY, on ? 'on' : 'off'); } catch { /* ignore */ }
  window.dispatchEvent(new Event('soundchange'));
}
export function usePrintAlarmHere(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState<boolean>(isPrintAlarmHere);
  useEffect(() => {
    const sync = () => setOn(isPrintAlarmHere());
    window.addEventListener('soundchange', sync);
    return () => window.removeEventListener('soundchange', sync);
  }, []);
  return [on, setPrintAlarmHere];
}

export function useSound() {
  const [on, setOnState] = useState<boolean>(isSoundOn);
  const [volume, setVolState] = useState<number>(getVolume);
  useEffect(() => {
    const sync = () => { setOnState(isSoundOn()); setVolState(getVolume()); };
    window.addEventListener('soundchange', sync);
    return () => window.removeEventListener('soundchange', sync);
  }, []);
  return {
    on,
    volume,
    setOn: setSoundOn,
    setVolume,
    toggle: () => setSoundOn(!isSoundOn()),
  };
}
