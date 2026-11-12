// ===== المصادقة: دخول، تسجيل مباشر، Google، وأمان الجلسة =====
import {
  auth, db, dref, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut,
  sendPasswordResetEmail, sendEmailVerification, updateProfile, GoogleAuthProvider, signInWithPopup,
  signInWithRedirect, setPersistence, browserLocalPersistence, browserSessionPersistence,
  getDoc, setDoc, onSnapshot, writeBatch
} from './firebase.js';
import { state, bus } from './state.js';
import { $, toast, errMsg, showErr, cleanName, isFourPartName, isEmail, passwordIssue, closeAllModals } from './utils.js';

const IDLE_MS = 30 * 60 * 1000;      // الخروج التلقائي بعد 30 دقيقة بلا نشاط
const LAST_KEY = 'ledger_last_active';
const HINT_KEY = 'ledger_hint';       // تلميح محلي: كان هناك مستخدم مسجّل (لتفادي وميض شاشة الدخول)

const MODES = {
  login:    { title: 'تسجيل الدخول', sub: 'مرحباً بعودتك. أدخل بياناتك للمتابعة.', fields: ['email', 'pass'], btn: 'تسجيل الدخول', row: true, google: true, tabs: true },
  signup:   { title: 'حساب جديد', sub: 'أنشئ حسابك وابدأ فوراً، بدون انتظار موافقة.', fields: ['name', 'email', 'pass', 'confirm'], btn: 'إنشاء الحساب', google: true, tabs: true },
  setup:    { title: 'إعداد النظام', sub: 'أنشئ حساب المالك الأول للنظام.', fields: ['name', 'email', 'pass', 'confirm'], btn: 'إنشاء حساب المالك', google: true },
  complete: { title: 'إكمال التسجيل', sub: 'أدخل اسمك الرباعي لإكمال حسابك.', fields: ['name'], btn: 'حفظ ومتابعة', logout: true },
  rejected: { title: 'الحساب موقوف', sub: 'تم إيقاف حسابك من المسؤول. تواصل معه إن كان ذلك خطأ.', fields: [], logout: true }
};

let mode = 'login', unwatch = null, fails = 0, lockedUntil = 0, lastTouch = Date.now(), linkCooldown = 0;
const uiErr = (m) => Object.assign(new Error(m), { ui: m });
const setHint = (on) => { try { on ? localStorage.setItem(HINT_KEY, '1') : localStorage.removeItem(HINT_KEY); } catch (e) {} };

/* ---------- واجهة الدخول ---------- */
function setMsg(text, ok = false) {
  const el = $('aMsg'); el.textContent = text || ''; el.hidden = !text; el.classList.toggle('ok', !!ok);
}

function setMode(m) {
  mode = m; const c = MODES[m];
  $('auth').classList.remove('loading');
  $('aTitle').textContent = c.title; $('aTitle').hidden = !!c.tabs;
  $('aSub').textContent = c.sub || ''; $('aSub').hidden = !c.sub;
  $('aTabs').hidden = !c.tabs;
  $('tab-login').classList.toggle('on', m === 'login'); $('tab-login').setAttribute('aria-selected', String(m === 'login'));
  $('tab-signup').classList.toggle('on', m === 'signup'); $('tab-signup').setAttribute('aria-selected', String(m === 'signup'));
  for (const f of ['name', 'email', 'pass', 'confirm']) $('f-' + f).hidden = !c.fields.includes(f);
  $('aRow').hidden = !c.row; $('aGoogle').hidden = !c.google;
  $('aBtn').hidden = !c.btn; if (c.btn) $('aBtn').textContent = c.btn;
  $('aLogout').hidden = !c.logout;
  $('aPass').autocomplete = m === 'login' ? 'current-password' : 'new-password';
  if (m === 'complete' && state.user) $('aName').value = cleanName(state.user.displayName || '');
  setMsg('');
}

function busy(on) {
  $('aBtn').disabled = on; $('aGoogle').disabled = on;
  if (on) $('aBtn').innerHTML = '<span class="lg-spin"></span>';
  else $('aBtn').textContent = MODES[mode].btn || '';
}

// المصباح: الضغط خارج البطاقة (أو على الحبل) يشغّل/يطفئ الإضاءة
function initLamp() {
  const root = $('auth'), bulb = $('bulb-light');
  let on = true; try { on = localStorage.getItem('ledger_lamp') !== '0'; } catch (e) {}
  const apply = () => {
    root.classList.toggle('lamp-off', !on); bulb.setAttribute('fill', on ? '#3CC3A5' : '#22312d');
    try { localStorage.setItem('ledger_lamp', on ? '1' : '0'); } catch (e) {}
  };
  const toggle = () => { on = !on; apply(); };
  apply();
  root.addEventListener('click', (e) => { if (!e.target.closest('#authCard')) toggle(); });
  $('cord-btn').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
}

/* ---------- أمان الجلسة: الخمول ---------- */
function touchNow() {
  lastTouch = Date.now();
  try { localStorage.setItem(LAST_KEY, String(lastTouch)); } catch (e) {}
}
function idleExpired() {
  try { const t = Number(localStorage.getItem(LAST_KEY)); return !!t && Date.now() - t > IDLE_MS; } catch (e) { return false; }
}
function initIdleWatch() {
  const onActivity = () => { if (Date.now() - lastTouch > 15000) touchNow(); };
  ['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach(ev => addEventListener(ev, onActivity, { passive: true }));
  const check = () => {
    if (state.access !== 'active') return;
    if (idleExpired()) { toast('تم تسجيل خروجك تلقائياً لعدم النشاط.', 'bad'); doSignOut(); }
  };
  setInterval(check, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
}

/* ---------- الجلسة ---------- */
async function checkSetup() {
  try { state.setupDone = (await getDoc(dref('meta', 'setup'))).exists(); }
  catch (e) { console.warn(e); state.setupDone = true; }
}

// تظهر شاشة الدخول فوراً، ثم نتحقق في الخلفية هل النظام مُعدّ أم لا
function showSignedOut() {
  $('app').hidden = true; $('auth').hidden = false; document.body.style.overflow = '';
  setMode('login');
  checkSetup().then(() => { if (!state.setupDone && (mode === 'login' || mode === 'signup')) setMode('setup'); });
}

function stopSession() {
  if (state.access === 'active') { state.access = 'none'; bus.emit('session:stop'); }
  state.access = 'none';
  $('app').hidden = true;
}

function teardown() {
  if (unwatch) { unwatch(); unwatch = null; }
  stopSession(); closeAllModals(); setHint(false);
  state.user = null; state.profile = null;
  for (const id of ['aPass', 'aConfirm']) $(id).value = '';
}

function activate(p) {
  const prev = state.profile; state.profile = p;
  if (state.access === 'active') {
    if (prev?.role !== p.role) { bus.emit('session:stop'); bus.emit('session:start'); }
    else bus.emit('profile:changed');
    return;
  }
  state.access = 'active';
  touchNow(); setHint(true);
  $('auth').hidden = true; $('app').hidden = false;
  bus.emit('session:start');
}

// مراقبة مستند المستخدم: الإيقاف أو الحذف يسري فوراً
function attachUser(user) {
  state.user = user;
  if (unwatch) unwatch();
  unwatch = onSnapshot(dref('users', user.uid), (snap) => {
    if (!snap.exists()) { state.profile = null; stopSession(); $('auth').hidden = false; setMode('complete'); return; }
    const p = snap.data();
    if (p.status === 'rejected') { state.profile = p; stopSession(); $('auth').hidden = false; setMode('rejected'); return; }
    activate(p);
  }, (err) => { console.error(err); toast(errMsg(err), 'bad'); doSignOut(); });
}

export async function doSignOut() {
  closeAllModals();
  try { await signOut(auth); } catch (e) { console.error(e); }
}

/* ---------- العمليات ---------- */
async function createProfileDocs(user, name, asOwner) {
  const base = { name, email: user.email, createdAt: Date.now() };
  if (asOwner) {
    const b = writeBatch(db);
    b.set(dref('meta', 'setup'), { ownerUid: user.uid, createdAt: Date.now() });
    b.set(dref('users', user.uid), { ...base, role: 'owner', status: 'active' });
    await b.commit(); state.setupDone = true;
  } else {
    // تسجيل مباشر: الحساب يعمل فوراً بدور «مُدخل بيانات» دون موافقة مسبقة
    await setDoc(dref('users', user.uid), { ...base, role: 'submitter', status: 'active' });
  }
}

function validateNew(v, withPass) {
  if (!isFourPartName(v.name)) throw uiErr('أدخل الاسم الرباعي كاملاً (أربع كلمات على الأقل، حروف فقط).');
  if (!withPass) return;
  if (!isEmail(v.email)) throw uiErr('أدخل بريداً إلكترونياً صحيحاً.');
  const issue = passwordIssue(v.pass); if (issue) throw uiErr(issue);
  if (v.pass !== v.confirm) throw uiErr('كلمتا المرور غير متطابقتين.');
}

async function doLogin(v) {
  if (Date.now() < lockedUntil) throw uiErr(`محاولات كثيرة. حاول بعد ${Math.ceil((lockedUntil - Date.now()) / 1000)} ثانية.`);
  if (!isEmail(v.email) || !v.pass) throw uiErr('أدخل البريد الإلكتروني وكلمة المرور.');
  await setPersistence(auth, $('aRemember').checked ? browserLocalPersistence : browserSessionPersistence);
  try { await signInWithEmailAndPassword(auth, v.email, v.pass); fails = 0; }
  catch (err) {
    if (['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found'].includes(err.code) && ++fails >= 5) { lockedUntil = Date.now() + 30000; fails = 0; }
    throw err;
  }
}

async function doSignup(v, asOwner) {
  validateNew(v, true);
  state.settingUp = true;
  let cred;
  try {
    cred = await createUserWithEmailAndPassword(auth, v.email, v.pass);
    await updateProfile(cred.user, { displayName: v.name });
    await createProfileDocs(cred.user, v.name, asOwner);
    try { await sendEmailVerification(cred.user); } catch (e) { console.warn(e); }
  } catch (err) {
    if (cred?.user) { try { await cred.user.delete(); } catch (e) {} }
    state.settingUp = false;
    if (err.code === 'permission-denied' && asOwner) throw uiErr('تم إعداد النظام مسبقاً. سجّل الدخول بحسابك.');
    throw err;
  }
  state.settingUp = false;
  attachUser(auth.currentUser);
}

async function doComplete(v) {
  validateNew(v, false);
  const setup = await getDoc(dref('meta', 'setup'));
  await createProfileDocs(state.user, v.name, !setup.exists());
  try { await updateProfile(state.user, { displayName: v.name }); } catch (e) {}
}

async function doGoogle() {
  setMsg(''); touchNow(); busy(true);
  try {
    await setPersistence(auth, $('aRemember').checked ? browserLocalPersistence : browserSessionPersistence);
    const provider = new GoogleAuthProvider(); provider.setCustomParameters({ prompt: 'select_account' });
    await signInWithPopup(auth, provider);
  } catch (err) {
    if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') return;
    if (err.code === 'auth/popup-blocked') { try { await signInWithRedirect(auth, new GoogleAuthProvider()); return; } catch (e) { err = e; } }
    console.error(err); setMsg(errMsg(err));
  } finally { busy(false); }
}

async function onSubmit(e) {
  e.preventDefault(); setMsg(''); touchNow();
  const v = { name: cleanName($('aName').value), email: $('aEmail').value.trim().toLowerCase(), pass: $('aPass').value, confirm: $('aConfirm').value };
  busy(true);
  try {
    if (mode === 'login') await doLogin(v);
    else if (mode === 'signup') await doSignup(v, false);
    else if (mode === 'setup') await doSignup(v, true);
    else if (mode === 'complete') await doComplete(v);
  } catch (err) { if (!err.ui) console.error(err); setMsg(err.ui || errMsg(err)); }   // أخطاء التحقق المعتادة لا تُسجَّل كأعطال
  finally { busy(false); }
}

async function onForgot() {
  const email = $('aEmail').value.trim().toLowerCase();
  if (!isEmail(email)) return setMsg('اكتب بريدك الإلكتروني أولاً ثم اضغط «نسيت كلمة المرور».');
  try { await sendPasswordResetEmail(auth, email); } catch (err) { console.warn(err); }
  setMsg('إن كان البريد مسجّلاً فستصلك رسالة لإعادة تعيين كلمة المرور.', true);
}

/* ---------- تفعيل البريد + تغيير كلمة المرور برسالة تحقق ---------- */
export function updateVerifyBar() { $('verifyBar').hidden = !state.user || state.user.emailVerified; }

async function resendVerification() {
  try { await sendEmailVerification(state.user); toast('أُرسلت رسالة التأكيد إلى بريدك'); }
  catch (err) { console.error(err); toast(errMsg(err), 'bad'); }
}
async function refreshVerification() {
  try {
    await state.user.reload(); await state.user.getIdToken(true);
    if (state.user.emailVerified) { toast('تم تفعيل بريدك'); bus.emit('verify:changed'); }
    else toast('لم يتم التفعيل بعد. افتح الرابط في رسالتك أولاً.', 'bad');
    updateVerifyBar();
  } catch (err) { console.error(err); toast(errMsg(err), 'bad'); }
}

// تغيير كلمة المرور لا يتم داخل التطبيق: نرسل رابط تحقق رسمياً إلى بريد الحساب،
// ومن يملك البريد فقط يستطيع اختيار كلمة مرور جديدة عبره.
async function onPasswordLink(e) {
  e.preventDefault(); showErr('pErr'); $('pOk').hidden = true;
  const wait = Math.ceil((linkCooldown - Date.now()) / 1000);
  if (wait > 0) return showErr('pErr', `انتظر ${wait} ثانية قبل إعادة إرسال الرابط.`);
  const btn = $('pBtn'); btn.disabled = true;
  try {
    await sendPasswordResetEmail(auth, state.user.email);
    linkCooldown = Date.now() + 60000;
    $('pOk').textContent = 'أُرسل رابط التحقق إلى بريدك. افتحه واختر كلمة مرور جديدة، ثم سجّل الدخول بها.';
    $('pOk').hidden = false;
  } catch (err) { console.error(err); showErr('pErr', errMsg(err)); }
  finally { btn.disabled = false; }
}

/* ---------- التهيئة ---------- */
export function initAuth() {
  initLamp();
  $('authForm').addEventListener('submit', onSubmit);
  $('tab-login').onclick = () => { if (mode !== 'login') setMode(state.setupDone === false ? 'setup' : 'login'); };
  $('tab-signup').onclick = () => { if (mode !== 'signup') setMode(state.setupDone === false ? 'setup' : 'signup'); };
  $('aGoogle').onclick = doGoogle;
  $('aForgot').onclick = onForgot;
  $('aLogout').onclick = doSignOut;
  $('aEye').onclick = () => {
    const hide = $('aPass').type === 'password';
    $('aPass').type = hide ? 'text' : 'password'; $('aConfirm').type = $('aPass').type;
    $('aEye').setAttribute('aria-label', hide ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور');
    $('aEye').classList.toggle('shown', hide);
  };
  $('vResend').onclick = resendVerification;
  $('vCheck').onclick = refreshVerification;
  $('passForm').addEventListener('submit', onPasswordLink);
  initIdleWatch();

  onAuthStateChanged(auth, async (user) => {
    if (state.settingUp) return;
    if (!user) { teardown(); showSignedOut(); return; }
    if (idleExpired()) { toast('انتهت الجلسة لعدم النشاط. سجّل الدخول من جديد.', 'bad'); await signOut(auth); return; }
    attachUser(user);
  });
}
