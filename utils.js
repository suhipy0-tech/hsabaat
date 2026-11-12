// ===== أدوات عامة: DOM، تحقق، إشعارات، نوافذ، ثيم =====
export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const toCents = (v) => Math.round(Number(v) * 100);
export const fmt = (c) => (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- التحقق ---------- */
export function parseAmount(raw) {
  const s = String(raw).trim()
    .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    .replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
    .replace(/[،,٫]/g, '.').replace(/\s/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
  return Math.round(parseFloat(s) * 100) / 100;
}
export const digitsOnly = (v) => String(v ?? '')
  .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
  .replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
  .replace(/\D/g, '');
export const cleanName = (s) => String(s || '').replace(/\s+/g, ' ').trim();
// الاسم الرباعي: أربع كلمات على الأقل، حروف فقط
export function isFourPartName(s) {
  const n = cleanName(s), parts = n.split(' ');
  return n.length <= 80 && /^[\p{L}\p{M} ]+$/u.test(n) && parts.length >= 4 && parts.every(p => p.length >= 2);
}
export const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
export function passwordIssue(p) {
  if (p.length < 8) return 'كلمة المرور يجب ألا تقل عن 8 أحرف.';
  if (!/[A-Za-z\u0600-\u06FF]/.test(p) || !/\d/.test(p)) return 'كلمة المرور يجب أن تحتوي على حروف وأرقام.';
  return '';
}

/* ---------- رسائل الأخطاء بالعربية ---------- */
const ERR = {
  'auth/invalid-credential': 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
  'auth/wrong-password': 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
  'auth/user-not-found': 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
  'auth/invalid-email': 'البريد الإلكتروني غير صالح.',
  'auth/email-already-in-use': 'هذا البريد مسجّل مسبقاً. جرّب تسجيل الدخول.',
  'auth/weak-password': 'كلمة المرور ضعيفة.',
  'auth/too-many-requests': 'محاولات كثيرة. انتظر قليلاً ثم أعد المحاولة.',
  'auth/network-request-failed': 'تعذر الاتصال. تحقق من الإنترنت.',
  'auth/operation-not-allowed': 'طريقة الدخول غير مفعّلة. فعّلها من Firebase Console ← Authentication ← Sign-in method.',
  'auth/unauthorized-domain': 'هذا النطاق غير مضاف. أضفه من Authentication ← Settings ← Authorized domains.',
  'auth/account-exists-with-different-credential': 'يوجد حساب بنفس البريد بطريقة دخول مختلفة.',
  'auth/requires-recent-login': 'سجّل الدخول من جديد ثم أعد المحاولة.',
  'auth/user-disabled': 'هذا الحساب معطّل.',
  'auth/popup-blocked': 'المتصفح منع نافذة Google. اسمح بالنوافذ المنبثقة وأعد المحاولة.',
  'permission-denied': 'لا تملك صلاحية لهذه العملية. تأكد من نشر قواعد Firestore.',
  'unavailable': 'الخدمة غير متاحة حالياً. أعد المحاولة.'
};
export const errMsg = (err) => ERR[err?.code] || 'حدث خطأ غير متوقع. حاول مرة أخرى.';

/* ---------- إشعارات سريعة ---------- */
export function toast(text, type = 'ok', action) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<i class="fa-solid ${type === 'bad' ? 'fa-triangle-exclamation' : 'fa-circle-check'}"></i><span>${esc(text)}</span>`;
  if (action) {
    const b = document.createElement('button');
    b.textContent = action.label;
    b.onclick = () => { action.run(); el.remove(); };
    el.appendChild(b);
  }
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), action ? 6000 : 3500);
}
export function showErr(id, msg) { const el = $(id); el.textContent = msg || ''; el.hidden = !msg; }

/* ---------- التواريخ ---------- */
export const dayKey = (ts) => { if (!ts) return 'x'; const d = new Date(ts); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
export function dayLabel(ts) {
  if (!ts) return 'بدون تاريخ';
  const k = dayKey(ts), n = new Date();
  if (k === dayKey(n.getTime())) return 'اليوم';
  if (k === dayKey(n.getTime() - 864e5)) return 'أمس';
  return new Date(ts).toLocaleDateString('ar', { weekday: 'long', day: 'numeric', month: 'long', year: new Date(ts).getFullYear() === n.getFullYear() ? undefined : 'numeric' });
}
export const timeStr = (ts) => ts ? new Date(ts).toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' }) : '';
export const shortDate = (ts) => ts ? new Date(ts).toLocaleDateString('ar', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
export const dateTimeStr = (ts) => ts ? `${shortDate(ts)} ${timeStr(ts)}` : '';

/* ---------- النوافذ ---------- */
let confirmDone = null;
export function openModal(id) {
  const m = $(id); m.hidden = false; document.body.style.overflow = 'hidden';
  setTimeout(() => m.querySelector('input:not([type=radio]):not([type=hidden]), textarea, button.btn-primary')?.focus(), 60);
}
export function closeModal(id) {
  if (id === 'confirmModal' && confirmDone) { confirmDone(); return; }
  $(id).hidden = true;
  if (![...document.querySelectorAll('[data-modal]')].some(m => !m.hidden)) document.body.style.overflow = '';
}
export function closeAllModals() {
  confirmDone = null;
  document.querySelectorAll('[data-modal]').forEach(m => { m.hidden = true; });
  document.body.style.overflow = '';
}
export function confirmDialog({ title, message, okText = 'تأكيد', cancelText = 'إلغاء', danger = false }) {
  return new Promise(resolve => {
    $('cfTitle').textContent = title; $('cfMsg').textContent = message;
    $('cfCancel').textContent = cancelText;
    const ok = $('cfOk'); ok.textContent = okText; ok.className = 'btn ' + (danger ? 'btn-danger' : 'btn-primary');
    const done = (v) => { confirmDone = null; closeModal('confirmModal'); resolve(v); };
    confirmDone = () => done(false);
    ok.onclick = () => done(true); $('cfCancel').onclick = () => done(false);
    openModal('confirmModal');
  });
}
export function initModals() {
  document.querySelectorAll('[data-modal]').forEach(m => {
    m.addEventListener('mousedown', e => { if (e.target === m) closeModal(m.id); });
    m.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => closeModal(m.id)));
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const open = [...document.querySelectorAll('[data-modal]')].filter(m => !m.hidden).pop();
    if (open) closeModal(open.id);
  });
}

/* ---------- الثيم ---------- */
export const currentThemeMode = () => { try { return localStorage.getItem('ledger_theme') || 'auto'; } catch (e) { return 'auto'; } };
export function applyTheme(mode) {
  try { localStorage.setItem('ledger_theme', mode); } catch (e) {}
  const dark = mode === 'dark' || (mode === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  $('themeIc').className = 'fa-solid ' + ({ auto: 'fa-circle-half-stroke', light: 'fa-sun', dark: 'fa-moon' }[mode]);
  $('themeBtn').title = { auto: 'الثيم: تلقائي', light: 'الثيم: نهاري', dark: 'الثيم: ليلي' }[mode];
  document.querySelector('meta[name=theme-color]').content = dark ? '#0B1210' : '#0E3B33';
}
export function initTheme() {
  $('themeBtn').onclick = () => {
    const next = { auto: 'light', light: 'dark', dark: 'auto' }[currentThemeMode()];
    applyTheme(next);
    toast({ auto: 'ثيم تلقائي (حسب الجهاز)', light: 'الثيم النهاري', dark: 'الثيم الليلي' }[next]);
  };
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (currentThemeMode() === 'auto') applyTheme('auto'); });
  applyTheme(currentThemeMode());
}
