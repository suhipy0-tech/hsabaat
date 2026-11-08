// ===== المصادقة: دخول، تسجيل، Google، موافقة الأدمن، وأمان الجلسة =====
import {
  auth, db, dref, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut,
  sendPasswordResetEmail, sendEmailVerification, updateProfile, updatePassword, reauthenticateWithCredential,
  EmailAuthProvider, GoogleAuthProvider, signInWithPopup, signInWithRedirect, setPersistence,
  browserLocalPersistence, browserSessionPersistence, getDoc, setDoc, onSnapshot, writeBatch
} from './firebase.js';
import { state, bus } from './state.js';
import {
  $, toast, errMsg, showErr, cleanName, isFourPartName, isEmail, passwordIssue, closeModal, closeAllModals
} from './utils.js';

const IDLE_MS = 30 * 60 * 1000;      // الخروج التلقائي بعد 30 دقيقة بلا نشاط
const LAST_KEY = 'ledger_last_active';
const MODES = {
  login:    { title: 'تسجيل الدخول', fields: ['email', 'pass'], btn: 'دخول', row: true, google: true, sw: { text: 'ليس لديك حساب؟ إنشاء حساب جديد', to: 'signup' } },
  signup:   { title: 'إنشاء حساب', fields: ['name', 'email', 'pass', 'confirm'], btn: 'إنشاء الحساب', google: true, sw: { text: 'لديك حساب؟ تسجيل الدخول', to: 'login' } },
  setup:    { title: 'إعداد النظام', sub: 'أنشئ حساب المالك الأول للنظام.', fields: ['name', 'email', 'pass', 'confirm'], btn: 'إنشاء حساب المالك', google: true },
  complete: { title: 'إكمال التسجيل', sub: 'أدخل اسمك الرباعي لإكمال حسابك.', fields: ['name'], btn: 'حفظ ومتابعة', logout: true },
  pending:  { title: 'بانتظار الموافقة', sub: 'تم استلام طلبك. سيفعّل المسؤول حسابك بعد المراجعة، وسيفتح التطبيق تلقائياً عند الموافقة.', fields: [], logout: true },
  rejected: { title: 'الحساب غير مفعّل', sub: 'تم رفض حسابك أو إيقافه من المسؤول. تواصل معه إن كان ذلك خطأ.', fields: [], logout: true }
};

let mode = 'login', unwatch = null, fails = 0, lockedUntil = 0, lastTouch = Date.now();
const uiErr = (m) => Object.assign(new Error(m), { ui: m });

/* ---------- واجهة الحلقة ---------- */
function buildRing() {
  const ring = $('ring'), total = 60, from = [111, 134, 214], to = [61, 245, 200];
  ring.style.setProperty('--bars', total);
  for (let i = 0; i < total; i++) {
    const bar = document.createElement('span');
    bar.className = 'rb'; bar.style.setProperty('--i', i);
    const t = (Math.sin((i / total) * Math.PI * 2) + 1) / 2;
    bar.style.setProperty('--c', `rgb(${from.map((f, k) => Math.round(f + (to[k] - f) * t)).join(',')})`);
    ring.prepend(bar);
  }
}

function setMsg(text, ok = false) {
  const el = $('aMsg'); el.textContent = text || ''; el.hidden = !text; el.classList.toggle('ok', !!ok);
}

function setMode(m) {
  mode = m; const c = MODES[m];
  $('auth').classList.remove('loading');
  $('aTitle').textContent = c.title;
  $('aSub').textContent = c.sub || ''; $('aSub').hidden = !c.sub;
  for (const f of ['name', 'email', 'pass', 'confirm']) $('f-' + f).hidden = !c.fields.includes(f);
  $('aRow').hidden = !c.row; $('aGoogle').hidden = !c.google;
  $('aBtn').hidden = !c.btn; if (c.btn) $('aBtn').textContent = c.btn;
  $('aSwitch').hidden = !c.sw; if (c.sw) { $('aSwitch').textContent = c.sw.text; $('aSwitch').dataset.to = c.sw.to; }
  $('aLogout').hidden = !c.logout;
  $('ring').classList.toggle('big', c.fields.length >= 4);
  $('aPass').autocomplete = m === 'login' ? 'current-password' : 'new-password';
  if (m === 'complete' && state.user) $('aName').value = cleanName(state.user.displayName || '');
  setMsg('');
}

function busy(on) {
  $('aBtn').disabled = on; $('aGoogle').disabled = on;
  if (on) $('aBtn').innerHTML = '<i class="fa-solid fa-spinner spin"></i>';
  else $('aBtn').textContent = MODES[mode].btn || '';
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

async function showSignedOut() {
  $('app').hidden = true; $('auth').hidden = false; document.body.style.overflow = '';
  await checkSetup();
  setMode(state.setupDone ? 'login' : 'setup');
}

function stopSession() {
  if (state.access === 'active') { state.access = 'none'; bus.emit('session:stop'); }
  state.access = 'none';
  $('app').hidden = true;
}

function teardown() {
  if (unwatch) { unwatch(); unwatch = null; }
  stopSession(); closeAllModals();
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
  touchNow();
  $('auth').hidden = true; $('app').hidden = false;
  bus.emit('session:start');
}

// مراقبة مستند المستخدم: أي تغيير في الصلاحية أو الحذف يسري فوراً
function attachUser(user) {
  state.user = user;
  if (unwatch) unwatch();
  unwatch = onSnapshot(dref('users', user.uid), (snap) => {
    if (!snap.exists()) { state.profile = null; stopSession(); $('auth').hidden = false; setMode('complete'); return; }
    const p = snap.data(), status = p.status || 'active';
    if (status === 'active') return activate(p);
    state.profile = p; stopSession(); $('auth').hidden = false;
    setMode(status === 'rejected' ? 'rejected' : 'pending');
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
    await setDoc(dref('users', user.uid), { ...base, role: 'submitter', status: 'pending' });
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
  } catch (err) { console.error(err); setMsg(err.ui || errMsg(err)); }
  finally { busy(false); }
}

async function onForgot() {
  const email = $('aEmail').value.trim().toLowerCase();
  if (!isEmail(email)) return setMsg('اكتب بريدك الإلكتروني أولاً ثم اضغط «نسيت كلمة المرور».');
  try { await sendPasswordResetEmail(auth, email); } catch (err) { console.warn(err); }
  setMsg('إن كان البريد مسجّلاً فستصلك رسالة لإعادة تعيين كلمة المرور.', true);
}

/* ---------- تفعيل البريد وكلمة المرور ---------- */
export const usesPassword = () => !!state.user?.providerData?.some(p => p.providerId === 'password');
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

async function onChangePassword(e) {
  e.preventDefault(); showErr('pErr');
  const cur = $('pCur').value, next = $('pNew').value;
  if (!cur) return showErr('pErr', 'أدخل كلمة المرور الحالية.');
  const issue = passwordIssue(next); if (issue) return showErr('pErr', issue);
  const btn = $('pBtn'); btn.disabled = true;
  try {
    await reauthenticateWithCredential(state.user, EmailAuthProvider.credential(state.user.email, cur));
    await updatePassword(state.user, next);
    $('passForm').reset(); closeModal('passModal'); toast('تم تحديث كلمة المرور');
  } catch (err) { console.error(err); showErr('pErr', errMsg(err)); }
  finally { btn.disabled = false; }
}

/* ---------- التهيئة ---------- */
export function initAuth() {
  buildRing();
  $('authForm').addEventListener('submit', onSubmit);
  $('aGoogle').onclick = doGoogle;
  $('aForgot').onclick = onForgot;
  $('aSwitch').onclick = () => setMode($('aSwitch').dataset.to);
  $('aLogout').onclick = doSignOut;
  $('aEye').onclick = () => {
    const hide = $('aPass').type === 'password';
    $('aPass').type = hide ? 'text' : 'password'; $('aConfirm').type = $('aPass').type;
    $('aEye').innerHTML = `<i class="fa-solid ${hide ? 'fa-eye-slash' : 'fa-eye'}"></i>`;
  };
  $('vResend').onclick = resendVerification;
  $('vCheck').onclick = refreshVerification;
  $('passForm').addEventListener('submit', onChangePassword);
  initIdleWatch();

  onAuthStateChanged(auth, async (user) => {
    if (state.settingUp) return;
    if (!user) { teardown(); await showSignedOut(); return; }
    if (idleExpired()) { toast('انتهت الجلسة لعدم النشاط. سجّل الدخول من جديد.', 'bad'); await signOut(auth); return; }
    attachUser(user);
  });
}
