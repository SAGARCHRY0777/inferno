/**
 * Tiny mission-control sound design via the Web Audio API (no audio assets).
 * Subtle synth blips on submit / result / error. Muteable + persisted. All
 * calls are guarded so they never throw (AudioContext needs a user gesture; the
 * first sound after any click works, earlier ones are silently skipped).
 */

const STORAGE = "inferno.muted";
let ctx: AudioContext | null = null;
let muted = (() => {
  try {
    return localStorage.getItem(STORAGE) === "1";
  } catch {
    return false;
  }
})();

function audio(): AudioContext | null {
  try {
    if (!ctx) {
      const AC: typeof AudioContext =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new AC();
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function note(freq: number, start: number, dur: number, gain = 0.05, type: OscillatorType = "sine") {
  const ac = audio();
  if (!ac) return;
  const t0 = ac.currentTime + start;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

export const sound = {
  isMuted: () => muted,
  setMuted(m: boolean) {
    muted = m;
    try {
      localStorage.setItem(STORAGE, m ? "1" : "0");
    } catch {
      /* ignore */
    }
    if (!m) note(880, 0, 0.12, 0.04, "triangle"); // confirm un-mute
  },
  submit() {
    if (muted) return;
    note(523.25, 0, 0.08, 0.035, "triangle");
    note(783.99, 0.06, 0.1, 0.03, "triangle");
  },
  success() {
    if (muted) return;
    note(659.25, 0, 0.09, 0.035, "sine");
    note(987.77, 0.08, 0.16, 0.03, "sine");
  },
  error() {
    if (muted) return;
    note(220, 0, 0.18, 0.05, "sawtooth");
    note(164.81, 0.1, 0.22, 0.04, "sawtooth");
  },
  // --- arcade game cues -------------------------------------------------- //
  blip() {
    if (muted) return;
    note(440, 0, 0.05, 0.03, "square");
  },
  caught() {
    if (muted) return;
    note(659.25, 0, 0.05, 0.04, "triangle");
    note(987.77, 0.05, 0.09, 0.035, "triangle");
  },
  deliver() {
    if (muted) return;
    note(587.33, 0, 0.08, 0.04, "sine");
    note(880, 0.07, 0.14, 0.035, "sine");
  },
  levelup() {
    if (muted) return;
    note(523.25, 0, 0.08, 0.04, "sine");
    note(659.25, 0.08, 0.08, 0.04, "sine");
    note(987.77, 0.16, 0.18, 0.04, "sine");
  },
  gameover() {
    if (muted) return;
    note(392, 0, 0.18, 0.05, "sawtooth");
    note(261.63, 0.14, 0.3, 0.045, "sawtooth");
  },
};
