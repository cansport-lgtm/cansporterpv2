// All wording for the Rejections & Wastages daily report, in English, Urdu and Roman Urdu.
// Roman Urdu uses easy words and common English words (report, submit, approve, loss, remarks).
// Department, material and reason names, user names, numbers and Rs. amounts are data and are never translated.

export type Lang = "en" | "ur" | "ro";
export const DEFAULT_LANG: Lang = "ro";
export const isLang = (v: unknown): v is Lang => v === "en" || v === "ur" || v === "ro";

const I: Record<Lang, 0 | 1 | 2> = { en: 0, ur: 1, ro: 2 };

// key: [English, Urdu, Roman Urdu]
const D = {
  pageTitle: ["R&W Daily Report", "ریجیکشن اور ویسٹیج کی روزانہ رپورٹ", "Rejection aur Wastage ki Daily Report"],
  pageDesc: [
    "Daily loss figures with the manager's remarks, submitted next morning and approved by a super admin",
    "روزانہ لاس کے اعداد و شمار اور مینیجر کے ریمارکس۔ اگلی صبح سبمٹ، اور سپر ایڈمن اپروو کرتا ہے",
    "Roz ka loss aur manager ke remarks. Agli subah submit hoti hai aur Super Admin approve karta hai",
  ],
  reportDate: ["Report date", "رپورٹ کی تاریخ", "Report ki date"],
  printA4: ["Print A4", "A4 پرنٹ", "A4 Print"],
  alsoEnglish: ["Also show English", "ساتھ انگلش بھی دکھائیں", "English bhi dikhayein"],
  tabReport: ["Report", "رپورٹ", "Report"],
  tab30: ["Last 30 days", "پچھلے 30 دن", "Pichle 30 din"],
  tabAlerts: ["Alert settings", "الرٹ سیٹنگز", "Alert settings"],

  stMissing: ["Not written", "لکھی نہیں گئی", "Likhi nahi gayi"],
  stDraft: ["Draft", "ڈرافٹ", "Draft"],
  stSubmitted: ["Awaiting approval", "اپروول کا انتظار", "Approval ka intezar"],
  stApproved: ["Approved", "اپروو ہو گئی", "Approve ho gayi"],
  stRejected: ["Sent back", "واپس بھیجی گئی", "Wapas bheji gayi"],
  dueReminder: ["Due", "ڈیو", "Due"],
  dueOverdue: ["Overdue", "لیٹ", "Late"],
  dueApproval: ["Approval overdue", "اپروول لیٹ", "Approval late"],
  locked: ["Entries for this day are locked", "اس دن کی انٹریز لاک ہیں", "Is din ki entries lock hain"],
  onlyManager: ["Only the rejections manager can write this report.", "یہ رپورٹ صرف ریجیکشن مینیجر لکھ سکتا ہے۔", "Ye report sirf Rejections Manager likh sakta hai."],

  reviewTitle: ["Review this report", "اس رپورٹ کو چیک کریں", "Is report ko check karein"],
  reasonPh: ["Reason (required when sending back)", "وجہ (واپس بھیجتے وقت ضروری)", "Wajah (wapas bhejte waqt zaroori)"],
  approve: ["Approve", "اپروو کریں", "Approve karein"],
  reject: ["Reject and send back", "ریجیکٹ کر کے واپس بھیجیں", "Reject karke wapas bhejein"],
  reopenPh: ["Reason for reopening (required)", "دوبارہ اوپن کرنے کی وجہ (ضروری)", "Dobara open karne ki wajah (zaroori)"],
  reopen: ["Reopen report", "رپورٹ دوبارہ اوپن کریں", "Report dobara open karein"],

  loading: ["Loading figures…", "اعداد و شمار لوڈ ہو رہے ہیں…", "Figures load ho rahe hain…"],
  noEntries: [
    "There are no rejection, wastage or leakage entries for this day, so no report is needed.",
    "اس دن کوئی ریجیکشن، ویسٹیج یا لیکیج انٹری نہیں ہے، اس لیے رپورٹ کی ضرورت نہیں۔",
    "Is din koi rejection, wastage ya leakage entry nahi hai, is liye report ki zaroorat nahi.",
  ],

  tileRej: ["Rejected qty", "ریجیکٹڈ مقدار", "Rejected qty"],
  tileWst: ["Wastage qty", "ویسٹیج مقدار", "Wastage qty"],
  tileLkg: ["Leakage qty", "لیکیج مقدار", "Leakage qty"],
  tileTotal: ["Total loss", "کل لاس", "Total loss"],
  allDepts: ["All departments", "تمام ڈیپارٹمنٹس", "Tamam departments"],
  vsPrev: ["vs previous day", "پچھلے دن کے مقابلے میں", "pichle din se"],
  vsAvg: ["vs average of earlier days this week", "اس ہفتے کے پچھلے دنوں کی اوسط سے", "is hafte ke pichle dinon ke average se"],
  kRejection: ["Rejection", "ریجیکشن", "Rejection"],
  kWastage: ["Wastage", "ویسٹیج", "Wastage"],
  kLeakage: ["Leakage", "لیکیج", "Leakage"],
  last7: ["Last 7 days · total loss", "پچھلے 7 دن · کل لاس", "Pichle 7 din · total loss"],
  topReasons: ["Top reasons", "سب سے زیادہ وجوہات", "Sab se zyada wajahein"],
  thReason: ["Reason", "وجہ", "Wajah"],
  thType: ["Type", "قسم", "Type"],
  thQty: ["Qty", "مقدار", "Qty"],
  thCost: ["Cost", "لاگت", "Cost"],
  byDept: ["By department", "ڈیپارٹمنٹ کے حساب سے", "Department ke hisab se"],
  thDept: ["Department", "ڈیپارٹمنٹ", "Department"],
  thRejQty: ["Rejected qty", "ریجیکٹڈ مقدار", "Rejected qty"],
  thTotalLoss: ["Total loss", "کل لاس", "Total loss"],
  thShare: ["Share", "حصہ", "Share"],

  remarksTitle: ["Manager remarks", "مینیجر کے ریمارکس", "Manager ke remarks"],
  remarksReq: ["Summary and biggest-loss remark are required", "سمری اور سب سے بڑے لاس کا ریمارک ضروری ہے", "Summary aur sab se bare loss ka remark likhna zaroori hai"],
  fSummary: ["Summary of the day", "آج کی سمری", "Aaj ki summary"],
  fBigDefault: ["Biggest loss", "سب سے بڑا لاس", "Sab se bara loss"],
  fAction: ["Corrective action and owner (optional)", "کیا ایکشن لینا ہے اور ذمہ دار کون ہے (اختیاری)", "Kya action lena hai aur kaun zimmedar hai (optional)"],
  phSummary: [
    "What drove today's loss, compared with normal days.",
    "عام دنوں کے مقابلے میں آج لاس کیوں ہوا؟",
    "Aam dinon ke muqable mein aaj loss kyun hua?",
  ],
  phBig: ["What happened there and what was found.", "وہاں کیا ہوا اور کیا وجہ ملی؟", "Wahan kya hua aur kya wajah mili?"],
  phAction: [
    "What is being done, who owns it, by when.",
    "کیا کیا جا رہا ہے، ذمہ دار کون ہے، اور کب تک؟",
    "Kya kiya ja raha hai, zimmedar kaun hai, aur kab tak?",
  ],
  noRemark: ["No remark.", "کوئی ریمارک نہیں۔", "Koi remark nahi."],
  saveDraft: ["Save Draft", "ڈرافٹ سیو کریں", "Draft save karein"],
  submit: ["Submit for Approval", "اپروول کے لیے سبمٹ کریں", "Approval ke liye submit karein"],

  historyTitle: ["History", "ہسٹری", "History"],
  noHistory: ["Nothing recorded for this day yet.", "اس دن کا ابھی کچھ ریکارڈ نہیں۔", "Is din ka abhi kuch record nahi."],
  hSaved: ["Saved", "سیو ہوئی", "Save hui"],
  hSubmitted: ["Submitted", "سبمٹ ہوئی", "Submit hui"],
  hApproved: ["Approved", "اپروو ہوئی", "Approve hui"],
  hRejected: ["Rejected", "ریجیکٹ ہوئی", "Reject hui"],
  hReopened: ["Reopened", "دوبارہ اوپن ہوئی", "Dobara open hui"],
  note: ["Note", "نوٹ", "Note"],
  reopenedPrefix: ["Reopened", "دوبارہ اوپن کی گئی", "Dobara open ki gayi"],

  thReportDate: ["Report date", "رپورٹ کی تاریخ", "Report ki date"],
  thStatus: ["Status", "اسٹیٹس", "Status"],
  thSubmitted: ["Submitted", "سبمٹ", "Submit"],
  thNextDeadline: ["Next deadline", "اگلی ڈیڈ لائن", "Agli deadline"],
  noDays: ["No days with entries yet.", "ابھی کوئی دن انٹری والا نہیں۔", "Abhi koi din entries wala nahi."],
  skipNote: [
    "Days with no rejection, wastage or leakage entries are skipped.",
    "جن دنوں کوئی ریجیکشن، ویسٹیج یا لیکیج انٹری نہ ہو وہ شامل نہیں۔",
    "Jin dinon koi rejection, wastage ya leakage entry na ho wo shamil nahi.",
  ],

  sTitle: ["Alert settings (super admin)", "الرٹ سیٹنگز (سپر ایڈمن)", "Alert settings (Super Admin)"],
  sEnabled: ["Send reminders and alerts", "ریمائنڈر اور الرٹ بھیجیں", "Reminder aur alert bhejein"],
  sReminder: ["Remind the manager next morning at", "مینیجر کو اگلی صبح ریمائنڈر", "Manager ko agli subah reminder"],
  sSubmitBy: ["Submit deadline next morning (Pakistan time)", "اگلی صبح سبمٹ کی ڈیڈ لائن (پاکستان ٹائم)", "Agli subah submit ki deadline (Pakistan time)"],
  sAlertTime: ["Daily repeat alert time", "روزانہ دوبارہ الرٹ کا ٹائم", "Roz dobara alert ka time"],
  sApprove: ["Approve within (hours of submission)", "اپروو کرنے کے گھنٹے (سبمٹ کے بعد)", "Approve karne ke ghante (submit ke baad)"],
  sResubmit: ["Re-submit within (hours of a send-back or reopen)", "دوبارہ سبمٹ کے گھنٹے (واپس بھیجنے یا اوپن کے بعد)", "Dobara submit ke ghante (wapas bhejne ya open ke baad)"],
  sStart: ["Track from date", "ٹریک کرنے کی شروعات", "Track karne ki shuruaat"],
  sSave: ["Save Settings", "سیٹنگز سیو کریں", "Settings save karein"],
  sSaving: ["Saving…", "سیو ہو رہی ہیں…", "Save ho rahi hain…"],

  tDraft: ["Draft saved", "ڈرافٹ سیو ہو گیا", "Draft save ho gaya"],
  tSubmitted: ["Submitted for approval", "اپروول کے لیے سبمٹ ہو گئی", "Approval ke liye submit ho gayi"],
  tApproved: ["Report approved", "رپورٹ اپروو ہو گئی", "Report approve ho gayi"],
  tSentBack: ["Report sent back to the manager", "رپورٹ مینیجر کو واپس بھیج دی گئی", "Report manager ko wapas bhej di gayi"],
  tReopened: ["Report reopened", "رپورٹ دوبارہ اوپن ہو گئی", "Report dobara open ho gayi"],
  tSettings: ["Alert settings saved", "الرٹ سیٹنگز سیو ہو گئیں", "Alert settings save ho gayin"],
  eGeneric: ["Something went wrong", "کچھ غلط ہو گیا", "Kuch masla ho gaya"],

  // A4 print
  pNotApproved: ["Not approved", "اپروو نہیں ہوئی", "Approve nahi hui"],
  pPrinted: ["Printed", "پرنٹ", "Print"],
  pPrepared: ["Prepared by (Rejections Manager)", "تیار کردہ (ریجیکشن مینیجر)", "Tayyar karne wala (Rejections Manager)"],
  pApproved: ["Approved by (Super Admin)", "اپروو کرنے والا (سپر ایڈمن)", "Approve karne wala (Super Admin)"],
  pPrevDay: ["Previous day", "پچھلا دن", "Pichla din"],
  pAvg: ["Average of earlier days this week", "اس ہفتے کے پچھلے دنوں کی اوسط", "Is hafte ke pichle dinon ka average"],
  pSummary: ["Summary of the day", "آج کی سمری", "Aaj ki summary"],
  pBigRemark: ["Remark on the biggest-loss department", "سب سے بڑے لاس والے ڈیپارٹمنٹ کا ریمارک", "Sab se bare loss wale department ka remark"],
  pAction: ["Corrective action and owner", "ایکشن اور ذمہ دار", "Action aur zimmedar"],
  pReviewNote: ["Review note", "ریویو نوٹ", "Review note"],
} as const;

export type TextKey = keyof typeof D;

export function t(lang: Lang, key: TextKey): string {
  return D[key][I[lang]];
}

// ---------------------------------------------------------------- dates
const WD: Record<Lang, string[]> = {
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  ur: ["اتوار", "پیر", "منگل", "بدھ", "جمعرات", "جمعہ", "ہفتہ"],
  ro: ["Itwar", "Peer", "Mangal", "Budh", "Jumeraat", "Juma", "Hafta"],
};
const MON: Record<Lang, string[]> = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  ur: ["جنوری", "فروری", "مارچ", "اپریل", "مئی", "جون", "جولائی", "اگست", "ستمبر", "اکتوبر", "نومبر", "دسمبر"],
  ro: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
};
const pad = (n: number) => String(n).padStart(2, "0");

/** "Friday, 27 Nov 2026" / "جمعہ، 27 نومبر 2026" / "Juma, 27 Nov 2026" */
export function fmtDay(lang: Lang, d: Date): string {
  return `${WD[lang][d.getDay()]}${lang === "ur" ? "،" : ","} ${d.getDate()} ${MON[lang][d.getMonth()]} ${d.getFullYear()}`;
}
/** "28 Nov 10:00" */
export function fmtStamp(lang: Lang, iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getDate()} ${MON[lang][d.getMonth()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
/** "Sat 28 Nov" */
export function fmtShortDay(lang: Lang, d: Date): string {
  return `${WD[lang][d.getDay()].slice(0, lang === "ur" ? 99 : 3)} ${d.getDate()} ${MON[lang][d.getMonth()]}`;
}

// ---------------------------------------------------------------- sentences with values
export const submitBy = (l: Lang, when: string) =>
  ({ en: `Submit by ${when}`, ur: `سبمٹ کرنے کی لاسٹ ٹائم: ${when}`, ro: `Submit karne ki last time: ${when}` })[l];
export const approveBy = (l: Lang, when: string) =>
  ({ en: `Approve by ${when}`, ur: `اپروول کی لاسٹ ٹائم: ${when}`, ro: `Approval ki last time: ${when}` })[l];
export const submittedBy = (l: Lang, name: string | null | undefined, when: string) =>
  name
    ? ({ en: `Submitted by ${name} ${when}`, ur: `${name} نے سبمٹ کی ${when}`, ro: `${name} ne submit ki ${when}` })[l]
    : ({ en: `Submitted ${when}`, ur: `سبمٹ ہوئی ${when}`, ro: `Submit hui ${when}` })[l];
export const approvedBy = (l: Lang, name: string | null | undefined, when: string) =>
  name
    ? ({ en: `Approved by ${name} ${when}`, ur: `${name} نے اپروو کی ${when}`, ro: `${name} ne approve ki ${when}` })[l]
    : ({ en: `Approved ${when}`, ur: `اپروو ہوئی ${when}`, ro: `Approve hui ${when}` })[l];
export const sentBackBy = (l: Lang, name: string | null | undefined, note: string) =>
  name
    ? ({ en: `Sent back by ${name}: ${note}`, ur: `${name} نے واپس بھیجی: ${note}`, ro: `${name} ne wapas bheji: ${note}` })[l]
    : ({ en: `Sent back: ${note}`, ur: `واپس بھیجی گئی: ${note}`, ro: `Wapas bheji gayi: ${note}` })[l];
export const biggestLoss = (l: Lang, dept: string, amount: string, pct: string) => {
  const head = t(l, "fBigDefault");
  return `${head}: ${dept} (${amount}${l === "ur" ? "،" : ","} ${pct}%)`;
};
export const printedAt = (l: Lang, when: string) => `${t(l, "pPrinted")} ${when}`;

// ---------------------------------------------------------------- server messages
// The database raises English messages (and a Roman Urdu + English one for the locked-day error).
const STATUS_WORD: Record<string, TextKey> = {
  draft: "stDraft", submitted: "stSubmitted", approved: "stApproved", rejected: "stRejected",
};
const E: [RegExp, [string, string, string]][] = [
  [/^Only the rejections manager can write/, ["Only the rejections manager can write this report.", "یہ رپورٹ صرف ریجیکشن مینیجر لکھ سکتا ہے۔", "Ye report sirf Rejections Manager likh sakta hai."]],
  [/^A report cannot be written for a future date/, ["A report cannot be written for a future date.", "آنے والی تاریخ کی رپورٹ نہیں لکھی جا سکتی۔", "Aane wali date ki report nahi likhi ja sakti."]],
  [/^There are no rejection, wastage or leakage entries/, ["There are no entries for this date.", "اس تاریخ کی کوئی انٹری نہیں ہے۔", "Is date ki koi entry nahi hai."]],
  [/^Write the summary and the remark/, ["Write the summary and the biggest-loss remark before submitting.", "سبمٹ کرنے سے پہلے آج کی سمری اور سب سے بڑے لاس کا ریمارک لکھیں۔", "Submit karne se pehle aaj ki summary aur sab se bare loss ka remark likhein."]],
  [/^Only a super admin can approve/, ["Only a super admin can approve this report.", "یہ رپورٹ صرف سپر ایڈمن اپروو کر سکتا ہے۔", "Ye report sirf Super Admin approve kar sakta hai."]],
  [/^There is no submitted report/, ["There is no submitted report for this date.", "اس تاریخ کی کوئی سبمٹ شدہ رپورٹ نہیں ہے۔", "Is date ki koi submitted report nahi hai."]],
  [/^Give a reason for rejecting/, ["Give a reason for rejecting the report.", "رپورٹ ریجیکٹ کرنے کی وجہ لکھیں۔", "Report reject karne ki wajah likhein."]],
  [/^Only a super admin can reopen/, ["Only a super admin can reopen an approved report.", "اپروو شدہ رپورٹ صرف سپر ایڈمن دوبارہ اوپن کر سکتا ہے۔", "Approved report sirf Super Admin dobara open kar sakta hai."]],
  [/^Give a reason for reopening/, ["Give a reason for reopening the report.", "رپورٹ دوبارہ اوپن کرنے کی وجہ لکھیں۔", "Report dobara open karne ki wajah likhein."]],
  [/^Only an approved report can be reopened/, ["Only an approved report can be reopened.", "صرف اپروو شدہ رپورٹ دوبارہ اوپن ہو سکتی ہے۔", "Sirf approved report dobara open ho sakti hai."]],
  [/^Only a super admin can change the report alert/, ["Only a super admin can change the alert settings.", "الرٹ سیٹنگز صرف سپر ایڈمن بدل سکتا ہے۔", "Alert settings sirf Super Admin badal sakta hai."]],
  [/^Hours must be between/, ["Hours must be between 1 and 336.", "گھنٹے 1 سے 336 کے درمیان ہونے چاہییں۔", "Ghante 1 se 336 ke darmiyan hone chahiye."]],
  [/^The reminder time must not be after/, ["The reminder time must not be after the submit deadline.", "ریمائنڈر کا ٹائم سبمٹ کی ڈیڈ لائن کے بعد نہیں ہو سکتا۔", "Reminder ka time submit ki deadline ke baad nahi ho sakta."]],
];

/** Turn a database error message into the user's language. Unknown messages are shown as they are. */
export function serverMessage(lang: Lang, raw: string | undefined | null): string {
  const msg = raw || "";
  if (!msg) return t(lang, "eGeneric");
  const lock = msg.match(/^(.+?) ki R&W daily report (submit|approve) ho chuki hai\./);
  if (lock) {
    const date = lock[1];
    const approved = lock[2] === "approve";
    if (lang === "ro") return msg.split(" | ")[0];
    if (lang === "en") return msg.split(" | ")[1] ?? msg;
    return `${date} کی رپورٹ ${approved ? "اپروو" : "سبمٹ"} ہو چکی ہے۔ اس دن کی انٹریز لاک ہیں، سپر ایڈمن رپورٹ دوبارہ اوپن کرے گا تب بدلیں گی۔`;
  }
  const edited = msg.match(/^This report is (\w+) and can no longer be edited/);
  if (edited) {
    const w = t(lang, STATUS_WORD[edited[1]] ?? "stDraft");
    return { en: `This report is ${edited[1]} and can no longer be edited.`, ur: `یہ رپورٹ "${w}" ہے، اب ایڈٹ نہیں ہو سکتی۔`, ro: `Ye report "${w}" hai, ab edit nahi ho sakti.` }[lang];
  }
  for (const [re, tr] of E) if (re.test(msg)) return tr[I[lang]];
  return msg;
}

/** Status word for a report status. */
export const statusLabel = (l: Lang, s: string) => t(l, ({ missing: "stMissing", ...STATUS_WORD } as Record<string, TextKey>)[s] ?? "stDraft");
