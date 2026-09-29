// Siren for the Gate Check page when an old pass is scanned again.
// Browsers only allow sound after a tap, so primeGateAlarm() is called on the
// guard's Open / Scan tap; the siren itself starts when the pass loads.

let ctx: AudioContext | null = null;
let stopFn: (() => void) | null = null;

export function primeGateAlarm() {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    // No audio on this device: the red screen still shows.
  }
}

export function startGateAlarm(seconds = 20) {
  stopGateAlarm();
  try {
    navigator.vibrate?.([600, 200, 600, 200, 600, 200, 600]);
  } catch {
    // ignore
  }
  if (!ctx) primeGateAlarm();
  if (!ctx) return;
  const c = ctx;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = "square";
  gain.gain.value = 0.25;
  osc.connect(gain).connect(c.destination);
  osc.start();
  let high = false;
  const tick = setInterval(() => {
    high = !high;
    osc.frequency.setValueAtTime(high ? 1250 : 700, c.currentTime);
  }, 350);
  const end = setTimeout(() => stopGateAlarm(), seconds * 1000);
  stopFn = () => {
    clearInterval(tick);
    clearTimeout(end);
    try { osc.stop(); osc.disconnect(); gain.disconnect(); } catch { /* already stopped */ }
  };
}

export function stopGateAlarm() {
  stopFn?.();
  stopFn = null;
  try { navigator.vibrate?.(0); } catch { /* ignore */ }
}
