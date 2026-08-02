/**
 * YABUZ OIL & GAS — UI sounds (Web Audio API, no asset files needed).
 * Three short pops: message sent, message received, new notification.
 * Respects the per-user preference stored in localStorage.
 */

const PREF_KEY = "yog.sounds.enabled";

export function soundsEnabled(): boolean {
  try {
    const v = localStorage.getItem(PREF_KEY);
    return v === null ? true : v === "1";
  } catch {
    return true;
  }
}

export function setSoundsEnabled(on: boolean) {
  try {
    localStorage.setItem(PREF_KEY, on ? "1" : "0");
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new Event("yog:sounds-changed"));
}

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    if (!ctx) {
      const AC =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function blip(
  ac: AudioContext,
  at: number,
  freq: number,
  dur: number,
  peak: number,
  type: OscillatorType = "sine",
) {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  osc.frequency.exponentialRampToValueAtTime(Math.max(60, freq * 0.72), at + dur);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(gain).connect(ac.destination);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

export type SoundKind = "send" | "receive" | "notify";

/** Play a UI pop sound. Silently no-ops when sounds are off or audio is unavailable. */
export function playSound(kind: SoundKind) {
  if (!soundsEnabled()) return;
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + 0.01;
  if (kind === "send") {
    blip(ac, t, 880, 0.09, 0.12, "triangle");
  } else if (kind === "receive") {
    blip(ac, t, 520, 0.11, 0.12, "sine");
    blip(ac, t + 0.09, 680, 0.1, 0.09, "sine");
  } else {
    blip(ac, t, 740, 0.08, 0.14, "triangle");
    blip(ac, t + 0.1, 988, 0.11, 0.12, "triangle");
  }
}
