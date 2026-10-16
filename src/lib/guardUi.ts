// Shared pieces for the guard's Gate Check screens: Urdu strings, the Urdu voice
// prompts, the "all good" beep and the office phone number.
//
// The gate keeper reads little, so every screen says one thing in large Urdu with
// small English under it, uses pictures and colour (green = go, red = stop), and can
// speak its prompt aloud. The guard can mute the voice; the choice is kept on the phone.

export const OFFICE_PHONE = "03332216339";
export const OFFICE_PHONE_TEL = "tel:+923332216339";

/** Inline style for Urdu text: Nastaliq where the phone has it, else any Arabic-script font. */
export const UR: React.CSSProperties = {
  fontFamily: "'Noto Nastaliq Urdu', 'Jameel Noori Nastaleeq', 'Noto Sans Arabic', 'Noto Naskh Arabic', system-ui, sans-serif",
  direction: "rtl",
  lineHeight: 1.6,
};

export const T = {
  gateCheck: "گیٹ چیک",
  scan: "اسکین کریں",
  scanSub: "SCAN the paper",
  noPaper: "کاغذ نہیں ہے؟",
  goodsOut: "گاڑی باہر",
  goodsBack: "سامان واپس",
  worker: "مزدور",
  staff: "اسٹاف",
  typeNumber: "نمبر لکھیں",
  open: "کھولیں",
  back: "واپس",
  plate: "گاڑی کا نمبر",
  same: "یہی ہے",
  different: "فرق ہے",
  otherVehicle: "دوسری گاڑی",
  handCarry: "ہاتھ میں / بغیر گاڑی",
  countBoxes: "ڈبے گنیں",
  boxes: "ڈبے",
  pieces: "عدد",
  iCounted: "میں نے گنے",
  answerAll: "ہر لائن کا جواب دیں",
  go: "جانے دیں",
  goSub: "GO · everything matches",
  stop: "روکیں",
  stopSub: "STOP · do not let it go",
  stopAndTell: "روکیں اور دفتر کو بتائیں",
  callOffice: "دفتر کو فون کریں",
  silence: "آواز بند",
  next: "اگلی گاڑی",
  nextPerson: "اگلا آدمی",
  oldPaper: "پرانا کاغذ — گاڑی نہ جانے دیں",
  notValid: "یہ کاغذ ابھی ٹھیک نہیں ہے",
  notFound: "یہ نمبر نہیں ملا",
  goodsCameBack: "سامان واپس آیا",
  scannedOld: "پرانا کاغذ اسکین ہوا",
  sameVehicleQ: "یہی گاڑی ہے؟",
  takePhoto: "تصویر لیں",
  openCamera: "کیمرہ کھولیں",
  retake: "دوبارہ لیں",
  save: "محفوظ کریں",
  saved: "محفوظ ہو گیا",
  vehicleLeft: "گاڑی چلی گئی",
  short: "کم ہیں",
  over: "زیادہ ہیں",
  lookPhoto: "تصویر اور آدمی کو دیکھیں",
  samePerson: "یہی آدمی ہے",
  notThisPerson: "یہ وہ نہیں ہے",
  waiting: "انتظار کریں…",
  storeBlocked: "اسٹور پاس نہیں ہے — اسٹور کو فون کریں",
  allBackQ: "پورا سامان واپس آ گیا؟",
  yesAll: "ہاں، پورا",
  noSome: "نہیں، کچھ کم ہے",
  received: "سامان وصول ہو گیا",
  officeWillReceive: "دفتر گنتی کرے گا",
};

/** What the phone says when a screen opens. Short, plain Urdu. */
export const SAY = {
  home: "کاغذ اسکین کریں",
  keypad: "کاغذ کا نمبر لکھیں",
  goods: "گاڑی کا نمبر دیکھیں۔ پھر ہر لائن کے ڈبے گنیں۔",
  go: "ٹھیک ہے۔ جانے دیں۔",
  stop: "روکیں۔ گاڑی کو نہ جانے دیں۔ دفتر کو فون کریں۔",
  oldPaper: "یہ پرانا کاغذ ہے۔ گاڑی کو نہ جانے دیں۔",
  notValid: "یہ کاغذ ابھی ٹھیک نہیں ہے۔ دفتر سے پوچھیں۔",
  notFound: "یہ نمبر نہیں ملا۔ دوبارہ دیکھیں۔",
  person: "تصویر اور آدمی کو دیکھیں۔ وہی ہے تو سبز بٹن دبائیں۔",
  back: "پرانا کاغذ اسکین کریں۔",
  backVehicle: "یہی گاڑی ہے؟",
  backPhoto: "کاغذ اور سامان کی تصویر لیں۔",
  saved: "محفوظ ہو گیا۔ شکریہ۔",
  allBackQ: "کیا پورا سامان واپس آ گیا؟",
  received: "سامان وصول ہو گیا۔ شکریہ۔",
  inward: "گاڑی چلی جائے تو بٹن دبائیں۔",
};

const MUTE_KEY = "guard-voice-muted";

export const isVoiceMuted = () => {
  try { return localStorage.getItem(MUTE_KEY) === "1"; } catch { return false; }
};
export const setVoiceMuted = (muted: boolean) => {
  try { localStorage.setItem(MUTE_KEY, muted ? "1" : "0"); } catch { /* ignore */ }
  if (muted) stopSpeaking();
};

const pickVoice = (): SpeechSynthesisVoice | null => {
  const voices = window.speechSynthesis?.getVoices?.() ?? [];
  return voices.find((v) => /^ur/i.test(v.lang))
    ?? voices.find((v) => /^hi/i.test(v.lang))   // Hindi is close enough to be understood when no Urdu voice is installed
    ?? null;
};

/** Say a prompt in Urdu. Silent when muted or when the phone has no speech at all. */
export function speak(text: string) {
  try {
    if (isVoiceMuted() || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const voice = pickVoice();
    if (voice) u.voice = voice;
    u.lang = voice?.lang ?? "ur-PK";
    u.rate = 0.9;
    window.speechSynthesis.speak(u);
  } catch {
    // no voice on this device
  }
}

export function stopSpeaking() {
  try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
}

let okCtx: AudioContext | null = null;

/** Two rising notes and one short vibration: everything matched. */
export function beepOk() {
  try { navigator.vibrate?.(150); } catch { /* ignore */ }
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    okCtx ??= new AC();
    if (okCtx.state === "suspended") void okCtx.resume();
    const c = okCtx;
    [[880, 0], [1320, 0.16]].forEach(([f, at]) => {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = "sine";
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.2, c.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + at + 0.18);
      osc.connect(gain).connect(c.destination);
      osc.start(c.currentTime + at);
      osc.stop(c.currentTime + at + 0.2);
    });
  } catch {
    // no audio
  }
}

/** Short warning buzz for "stop" (the full 20 s siren stays for old passes). */
export function buzzStop() {
  try { navigator.vibrate?.([400, 150, 400, 150, 400]); } catch { /* ignore */ }
}
