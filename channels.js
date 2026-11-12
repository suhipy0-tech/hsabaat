// ===== القنوات: طلبات الارتباط بين المستخدمين + دفتر مشترك متزامن =====
// كل معاملة داخل القناة تُسجَّل دائماً بنفس الاتجاه (يسجّلها المُرسِل)،
// ولا توجد خانة لاختيار الاتجاه. الطرف الآخر يؤكدها أو يرفضها.
import { col, dref, db, onSnapshot, query, where, addDoc, updateDoc, deleteDoc, writeBatch } from './firebase.js';
import { state, bus } from './state.js';
import {
  $, esc, fmt, toCents, parseAmount, digitsOnly, toast, showErr, errMsg, openModal, confirmDialog, isEmail,
  dayKey, dayLabel, timeStr, shortDate
} from './utils.js';

let unsubs = [];
const entryUnsubs = new Map();
let seenIncoming = null;

const me = () => state.user.uid;
const verified = () => !!state.user?.emailVerified;
const otherId = (c) => c.members.find(m => m !== me());
const entriesOf = (cid) => state.entries[cid] || [];
const toConfirm = (cid) => entriesOf(cid).filter(e => e.status === 'pending' && e.creatorUid !== me());

export const incomingPending = () => state.incoming.filter(r => r.status === 'pending');
export const entriesToConfirmCount = () => state.channels.reduce((n, c) => n + toConfirm(c.id).length, 0);
export const confirmList = () => state.channels.map(c => ({ channel: c, n: toConfirm(c.id).length })).filter(x => x.n);

// بيانات عرض القناة (اسم وبريد الطرف الآخر)
export function channelInfo(c) {
  const o = otherId(c);
  return { id: c.id, name: c.names?.[o] || 'مستخدم', email: c.emails?.[o] || '', other: o };
}

// إحصاءات القناة بالفلس (المعاملات المؤكدة فقط في المجاميع)
export function channelStats(cid) {
  let mine = 0, theirs = 0, last = 0;
  const list = entriesOf(cid);
  for (const e of list) {
    if ((e.createdAt || 0) > last) last = e.createdAt;
    if (e.status !== 'confirmed') continue;
    const c = (e.type === 'subtract' ? -1 : 1) * toCents(e.amount);   // معاملات قديمة بنوع subtract تُحتسب سالبة
    if (e.creatorUid === me()) mine += c; else theirs += c;
  }
  return { mine, theirs, net: mine - theirs, last, count: list.length, toConfirm: toConfirm(cid).length };
}
export const entriesList = (cid) => entriesOf(cid);

const netClass = (n) => n > 0 ? 'pos' : n < 0 ? 'neg' : 'zero';
const netText = (n) => (n < 0 ? '−' : n > 0 ? '+' : '') + fmt(Math.abs(n));
const netHint = (n) => n > 0 ? 'المُرسَل منك أكثر' : n < 0 ? 'المُرسَل منه أكثر' : 'متعادل';

/* ---------- التشغيل والإيقاف ---------- */
export function startChannels() {
  stopChannels();
  if (!state.user || !verified()) { renderChannels(); return; }   // القنوات تتطلب بريداً مفعّلاً
  const uid = me(), email = state.user.email.toLowerCase();
  const fail = (err) => { console.error(err); toast(errMsg(err), 'bad'); };

  unsubs.push(onSnapshot(query(col('requests'), where('toEmail', '==', email)), (snap) => {
    const list = []; snap.forEach(d => list.push({ id: d.id, ...d.data() }));
    list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    state.incoming = list;
    const pend = incomingPending();
    if (seenIncoming) pend.filter(r => !seenIncoming.has(r.id)).forEach(r => toast(`طلب قناة جديد من ${r.fromName}`));
    seenIncoming = new Set(pend.map(r => r.id));
    renderChannels(); bus.emit('badges');
  }, fail));

  unsubs.push(onSnapshot(query(col('requests'), where('fromUid', '==', uid)), (snap) => {
    const list = []; snap.forEach(d => list.push({ id: d.id, ...d.data() }));
    list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    state.outgoing = list; renderChannels();
  }, fail));

  unsubs.push(onSnapshot(query(col('channels'), where('members', 'array-contains', uid)), (snap) => {
    const list = []; snap.forEach(d => list.push({ id: d.id, ...d.data() }));
    list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    state.channels = list; state.chLoaded = true; syncEntryListeners(); renderChannels(); bus.emit('badges');
  }, fail));
}

export function stopChannels() {
  unsubs.forEach(u => u()); unsubs = [];
  entryUnsubs.forEach(u => u()); entryUnsubs.clear();
  seenIncoming = null;
  state.incoming = []; state.outgoing = []; state.channels = []; state.entries = {};
  state.chLoaded = false; state.openChannel = null;
  renderChannels(); bus.emit('badges');
}

function syncEntryListeners() {
  const ids = new Set(state.channels.map(c => c.id));
  for (const [id, u] of entryUnsubs) if (!ids.has(id)) { u(); entryUnsubs.delete(id); delete state.entries[id]; }
  for (const id of ids) {
    if (entryUnsubs.has(id)) continue;
    entryUnsubs.set(id, onSnapshot(col('channels', id, 'entries'), (snap) => {
      const list = []; snap.forEach(d => list.push({ id: d.id, ...d.data() }));
      list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      state.entries[id] = list;
      renderChannels(); if (state.openChannel === id) renderChannelModal(); bus.emit('badges');
    }, (err) => console.error(err)));
  }
}

/* ---------- الطلبات ---------- */
async function sendRequest(e) {
  e.preventDefault(); showErr('reqErr');
  if (!verified()) return showErr('reqErr', 'فعّل بريدك الإلكتروني أولاً.');
  const email = $('reqEmail').value.trim().toLowerCase();
  if (!isEmail(email)) return showErr('reqErr', 'أدخل بريداً إلكترونياً صحيحاً.');
  if (email === state.user.email.toLowerCase()) return showErr('reqErr', 'لا يمكنك إرسال طلب لنفسك.');
  if (state.channels.some(c => Object.values(c.emails || {}).includes(email))) return showErr('reqErr', 'لديك قناة مفتوحة مع هذا الحساب بالفعل.');
  if (state.outgoing.some(r => r.status === 'pending' && r.toEmail === email)) return showErr('reqErr', 'أرسلت طلباً لهذا الحساب وهو بانتظار الرد.');
  if (incomingPending().some(r => r.fromEmail === email)) return showErr('reqErr', 'هذا المستخدم أرسل طلباً بالفعل. اقبله من «طلبات واردة».');
  const btn = $('reqBtn'); btn.disabled = true;
  try {
    await addDoc(col('requests'), {
      fromUid: me(), fromName: state.profile.name, fromEmail: state.user.email, toEmail: email, status: 'pending', createdAt: Date.now()
    });
    $('reqForm').reset(); toast('أُرسل الطلب. سيصل للطرف الآخر عند دخوله بهذا البريد.');
  } catch (err) { console.error(err); showErr('reqErr', errMsg(err)); }
  finally { btn.disabled = !verified(); }
}

export async function respondRequest(id, accept) {
  const r = state.incoming.find(x => x.id === id); if (!r) return;
  try {
    if (!accept) {
      await updateDoc(dref('requests', id), { status: 'rejected', respondedAt: Date.now() });
      toast('تم رفض الطلب'); return;
    }
    const b = writeBatch(db);
    b.update(dref('requests', id), { status: 'accepted', respondedAt: Date.now() });
    b.set(dref('channels', id), {
      members: [r.fromUid, me()],
      names: { [r.fromUid]: r.fromName, [me()]: state.profile.name },
      emails: { [r.fromUid]: r.fromEmail, [me()]: state.user.email },
      createdAt: Date.now()
    });
    await b.commit(); toast(`تم فتح القناة مع ${r.fromName}`);
  } catch (err) { console.error(err); toast(errMsg(err), 'bad'); }
}

async function cancelRequest(id) {
  try { await updateDoc(dref('requests', id), { status: 'cancelled', respondedAt: Date.now() }); toast('تم إلغاء الطلب'); }
  catch (err) { console.error(err); toast(errMsg(err), 'bad'); }
}

/* ---------- عرض صفحة القنوات ---------- */
function statTiles(s) {
  return `<div class="stats3">
    <div><small>المُرسَل منك</small><b class="num">${fmt(s.mine)}</b></div>
    <div><small>المُرسَل منه</small><b class="num">${fmt(s.theirs)}</b></div>
    <div><small>الصافي</small><b class="num ${netClass(s.net)}">${netText(s.net)}</b></div>
  </div>`;
}

function renderChannels() {
  const ok = !!state.user && verified();
  $('reqBtn').disabled = !ok; $('reqEmail').disabled = !ok;
  const inc = incomingPending();
  const confirmN = entriesToConfirmCount();
  $('chCnt').hidden = !(inc.length + confirmN); $('chCnt').textContent = inc.length + confirmN;

  $('incomingCard').hidden = !inc.length;
  $('incomingList').innerHTML = inc.map(r => `<div class="req"><div class="avatar">${esc((r.fromName || '؟').charAt(0))}</div>
    <div class="grow"><b>${esc(r.fromName)}</b><small>${esc(r.fromEmail)}</small></div>
    <div class="btns"><button class="btn btn-primary btn-sm" data-r="acc" data-id="${esc(r.id)}"><i class="fa-solid fa-check"></i>قبول</button>
    <button class="btn btn-soft btn-sm" data-r="rej" data-id="${esc(r.id)}"><i class="fa-solid fa-xmark"></i>رفض</button></div></div>`).join('');

  const out = state.outgoing.filter(r => r.status === 'pending' || r.status === 'rejected').slice(0, 8);
  $('outgoingCard').hidden = !out.length;
  $('outgoingList').innerHTML = out.map(r => `<div class="req"><div class="avatar"><i class="fa-solid fa-paper-plane" style="font-size:.8rem"></i></div>
    <div class="grow"><b>${esc(r.toEmail)}</b><small>${r.status === 'pending' ? 'بانتظار الرد' : 'تم رفض طلبك'}</small></div>
    ${r.status === 'pending' ? `<div class="btns"><button class="btn btn-soft btn-sm" data-r="cancel" data-id="${esc(r.id)}">إلغاء الطلب</button></div>` : ''}</div>`).join('');

  $('chCounter').textContent = state.channels.length ? `${state.channels.length} قناة` : '';
  const box = $('channelsList');
  if (!ok) box.innerHTML = `<div class="empty"><i class="fa-solid fa-envelope-circle-check"></i>فعّل بريدك الإلكتروني لاستخدام القنوات.</div>`;
  else if (!state.chLoaded) box.innerHTML = '<div class="skel"></div><div class="skel"></div>';
  else if (!state.channels.length) box.innerHTML = `<div class="empty"><i class="fa-solid fa-link"></i>لا توجد قنوات بعد.<br>أرسل طلباً لبريد الطرف الآخر لتبدأ.</div>`;
  else box.innerHTML = `<div class="chgrid">${state.channels.map(c => {
    const i = channelInfo(c), s = channelStats(c.id);
    return `<button class="chcard" data-open="${esc(c.id)}">
      <div class="chcard-top"><div class="avatar">${esc(i.name.charAt(0))}</div>
        <div class="grow"><b>${esc(i.name)}</b><small>${esc(i.email)}</small></div>
        ${s.toConfirm ? `<span class="tagp">${s.toConfirm} بانتظار تأكيدك</span>` : ''}</div>
      ${statTiles(s)}
      <div class="chcard-bot"><span class="note">${s.count} معاملة</span><span class="note">آخر حركة: ${esc(s.last ? shortDate(s.last) : 'لا يوجد')}</span></div>
    </button>`;
  }).join('')}</div>`;
  bus.emit('channels:changed');
}

/* ---------- الدفتر المشترك داخل القناة ---------- */
export function openChannel(cid) {
  if (!state.channels.some(c => c.id === cid)) return;
  state.openChannel = cid; showErr('eErr'); $('entryForm').reset();   // الحقول فارغة دائماً: بلا توليد أو اقتراحات
  renderChannelModal(); openModal('chModal');
}

function renderChannelModal() {
  const c = state.channels.find(x => x.id === state.openChannel); if (!c) return;
  const i = channelInfo(c), s = channelStats(c.id);
  $('chTitle').textContent = i.name; $('chSub').textContent = i.email;
  $('chTiles').innerHTML = statTiles(s);
  $('chHint').textContent = netHint(s.net);

  const list = entriesOf(c.id);
  if (!list.length) { $('entriesList').innerHTML = `<div class="empty"><i class="fa-regular fa-folder-open"></i>لا توجد معاملات بعد في هذه القناة.</div>`; return; }
  let html = '', last = null;
  for (const e of list) {
    const k = dayKey(e.createdAt);
    if (k !== last) { html += `<div class="day">${esc(dayLabel(e.createdAt))}</div>`; last = k; }
    const mine = e.creatorUid === me();
    const st = e.status === 'confirmed' ? 'approved' : e.status;
    const label = e.status === 'confirmed' ? 'مؤكدة' : e.status === 'rejected' ? 'مرفوضة' : (mine ? 'بانتظار تأكيد الطرف الآخر' : 'بانتظار تأكيدك');
    let actions = '';
    if (e.status === 'pending' && !mine) actions = `<button class="btn btn-primary btn-sm" data-e="confirmed" data-id="${esc(e.id)}"><i class="fa-solid fa-check"></i>تأكيد</button><button class="btn btn-soft btn-sm" data-e="rejected" data-id="${esc(e.id)}"><i class="fa-solid fa-xmark"></i>رفض</button>`;
    if (e.status === 'pending' && mine) actions = `<button class="btn btn-soft btn-sm" data-e="withdraw" data-id="${esc(e.id)}"><i class="fa-solid fa-rotate-left"></i>سحب</button>`;
    html += `<article class="tx ${mine ? 'add' : 'sub'}"><div class="tx-ic"><i class="fa-solid ${mine ? 'fa-arrow-up' : 'fa-arrow-down'}"></i></div>
      <div class="tx-main"><div class="tx-ref"><span class="ref">${e.reference ? '#' + esc(e.reference) : 'معاملة'}</span><span class="tx-cat">${mine ? 'منك' : 'منه'}</span></div>
      ${e.notes ? `<div class="tx-note" title="${esc(e.notes)}">${esc(e.notes)}</div>` : ''}
      <div class="tx-meta">${mine ? 'أنت' : esc(e.creatorName)} · ${esc(shortDate(e.createdAt))} ${esc(timeStr(e.createdAt))}</div></div>
      <div class="tx-side"><span class="tx-amt num">${e.type === 'subtract' ? '−' : ''}${fmt(toCents(e.amount))}</span><span class="st st-${st}">${label}</span></div>
      ${actions ? `<div class="tx-actions">${actions}</div>` : ''}</article>`;
  }
  $('entriesList').innerHTML = html;
}

async function addEntry(e) {
  e.preventDefault(); showErr('eErr');
  const cid = state.openChannel; if (!cid) return;
  const amount = parseAmount($('eAmount').value), notes = $('eNotes').value.trim();
  const reference = digitsOnly($('eRef').value);
  if (!(amount > 0) || amount > 1e9) return showErr('eErr', 'أدخل مبلغاً صحيحاً (حتى خانتين عشريتين).');
  if (!/^[0-9]{4,20}$/.test(reference)) return showErr('eErr', 'رقم المعاملة إلزامي: أرقام فقط وبحد أدنى 4 أرقام.');
  if (entriesOf(cid).some(x => x.reference === reference)) return showErr('eErr', 'رقم المعاملة هذا مستخدم من قبل في هذه القناة.');
  const btn = $('eBtn'); btn.disabled = true;
  try {
    await addDoc(col('channels', cid, 'entries'), {
      creatorUid: me(), creatorName: state.profile.name, type: 'add', reference, amount, notes, createdAt: Date.now(), status: 'pending'
    });
    $('entryForm').reset(); toast('أُرسلت المعاملة للطرف الآخر للتأكيد');
  } catch (err) { console.error(err); showErr('eErr', errMsg(err)); }
  finally { btn.disabled = false; }
}

async function entryAction(id, act) {
  const cid = state.openChannel; if (!cid) return;
  try {
    if (act === 'withdraw') {
      if (!(await confirmDialog({ title: 'سحب المعاملة', message: 'سيتم حذفها قبل تأكيد الطرف الآخر.', okText: 'سحب', danger: true }))) return;
      await deleteDoc(dref('channels', cid, 'entries', id)); toast('تم سحب المعاملة');
    } else {
      await updateDoc(dref('channels', cid, 'entries', id), { status: act, respondedAt: Date.now() });
      toast(act === 'confirmed' ? 'تم تأكيد المعاملة' : 'تم رفض المعاملة');
    }
  } catch (err) { console.error(err); toast(errMsg(err), 'bad'); }
}

/* ---------- ربط الأحداث ---------- */
export function initChannelsUI() {
  $('reqForm').addEventListener('submit', sendRequest);
  $('entryForm').addEventListener('submit', addEntry);
  // رقم المعاملة: أرقام فقط، بدون حروف أو رموز أو مسافات (يشمل اللصق والكتابة من لوحة الجوال)
  $('eRef').addEventListener('input', (e) => { const v = digitsOnly(e.target.value); if (v !== e.target.value) e.target.value = v; });
  $('channelsList').addEventListener('click', (e) => { const b = e.target.closest('[data-open]'); if (b) openChannel(b.dataset.open); });
  const reqClick = (e) => {
    const b = e.target.closest('[data-r]'); if (!b) return;
    if (b.dataset.r === 'acc') respondRequest(b.dataset.id, true);
    else if (b.dataset.r === 'rej') respondRequest(b.dataset.id, false);
    else if (b.dataset.r === 'cancel') cancelRequest(b.dataset.id);
  };
  $('incomingList').addEventListener('click', reqClick);
  $('outgoingList').addEventListener('click', reqClick);
  $('entriesList').addEventListener('click', (e) => { const b = e.target.closest('[data-e]'); if (b) entryAction(b.dataset.id, b.dataset.e); });
}
