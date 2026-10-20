import { useSyncExternalStore } from 'react';

// SPEC §10.2: a distinct chime (green), buzz (red) and double tone (amber). Generated with Web Audio,
// so there are no sound files. navigator.vibrate only where it exists: never relied on (iOS lacks it).
type Sound = 'chime' | 'buzz' | 'double';

function vibrate(pattern: number | number[]): void {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(pattern);
}

// §10.5: a badge read ticks at once, before the server answers, so the volunteer knows the tap registered.
// Two quick taps: unlike every result pattern, so it can't be felt as the green single pulse.
export const vibrateRead = () => vibrate([30, 60, 30]);

// Chrome ignores navigator.vibrate (and keeps audio silent) until the page has been tapped once.
const ACTIVATION_EVENTS = ['click', 'pointerup', 'keydown'] as const;
function subscribeActivation(onChange: () => void) {
  for (const e of ACTIVATION_EVENTS) window.addEventListener(e, onChange, true);
  return () => {
    for (const e of ACTIVATION_EVENTS) window.removeEventListener(e, onChange, true);
  };
}
export function useNeedsTap(): boolean {
  return useSyncExternalStore(subscribeActivation, () => navigator.userActivation?.hasBeenActive === false, () => false);
}

let audio: AudioContext | null = null;

// iOS only allows audio after a user gesture: call this from the first tap.
export function unlockAudio(): void {
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
  } catch {
    audio = null;
  }
}

function tone(ctx: AudioContext, freq: number, start: number, duration: number, type: OscillatorType) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, ctx.currentTime + start);
  gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(ctx.currentTime + start);
  osc.stop(ctx.currentTime + start + duration + 0.02);
}

const PATTERNS: Record<Sound, { tones: Array<[number, number, number, OscillatorType]>; vibrate: number[] }> = {
  chime: { tones: [[880, 0, 0.12, 'sine'], [1320, 0.12, 0.2, 'sine']], vibrate: [60] },
  buzz: { tones: [[160, 0, 0.45, 'square']], vibrate: [250, 80, 250] },
  double: { tones: [[660, 0, 0.12, 'triangle'], [660, 0.2, 0.12, 'triangle']], vibrate: [80, 80, 80] },
};

export function playFeedback(sound: Sound): void {
  const p = PATTERNS[sound];
  try {
    if (audio && audio.state === 'running') for (const [f, s, d, t] of p.tones) tone(audio, f, s, d, t);
  } catch {
    // sound is a nicety; the screen is the source of truth
  }
  vibrate(p.vibrate);
}
