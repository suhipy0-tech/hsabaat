// ===== القنوات: طلبات الارتباط بين المستخدمين + دفتر مشترك متزامن =====
import { col, dref, db, onSnapshot, query, where, addDoc, updateDoc, deleteDoc, writeBatch } from './firebase.js';
import { state, bus } from './state.js';
import {
  $, esc, fmt, toCents, parseAmount, toast, showErr, errMsg, openModal, confirmDialog, isEmail, dayKey, dayLabel, timeStr
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

// رصيدي مع الطرف الآخر من المعاملات المؤكدة فقط (المعاملة تظهر للطرف الآخر بالعكس)
function balanceCents(cid) {
  let b = 0;
  for (const e of entriesOf(cid)) {
    if (e.status !== 'confirmed') continue;
    b += (e.type === 'subtract' ? -1 : 1) * (e.creatorUid === me() ? 1 : -1) * toCents(e.amount);
  }
  return b;
}
const balClass = (b) => b > 0 ? 'pos' : b < 0 ? 'neg' : 'zero';
const balWord = (b) => b > 0 ? 'لك' : b < 0 ? 'عليك' : 'متعادل';

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
  if (incomingPending().some(r => r.fromEmail === email)) return showErr('reqErr', 'هذا المستخدم أرسل لك طلباً. اقبله من «طلبات واردة».');
  const btn = $('reqBtn'); btn.disabled = true;
  try {
    await addDoc(col('requests'), {
      fromUid: me(), fromName: state.profile.name, fromEmail: state.user.email, toEmail: email, status: 'pending', createdAt: Date.now()
    });
    $('reqForm').reset(); toast('أُرسل الطلب. سيصل للطرف الآخر عند دخوله بهذا البريد.');
  } catch (err) { console.error(err); showErr('reqErr', errMsg(err)); }
  finally { btn.disabled = false; }
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

/* ---------- عرض القنوات ---------- */
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
  if (!ok) { box.innerHTML = `<div class="empty"><i class="fa-solid fa-envelope-circle-check"></i>فعّل بريدك الإلكتروني لاستخدام القنوات.</div>`; return; }
  if (!state.chLoaded) { box.innerHTML = '<div class="skel"></div><div class="skel"></div>'; return; }
  if (!state.channels.length) { box.innerHTML = `<div class="empty"><i class="fa-solid fa-link"></i>لا توجد قنوات بعد.<br>أرسل طلباً لبريد الطرف الآخر لتبدأ.</div>`; return; }
  box.innerHTML = `<div class="chgrid">${state.channels.map(c => {
    const o = otherId(c), b = balanceCents(c.id), n = toConfirm(c.id).length;
    return `<button class="chcard" data-open="${esc(c.id)}"><div class="chcard-top"><div class="avatar">${esc((c.names?.[o] || '؟').charAt(0))}</div>
      <div><b>${esc(c.names?.[o] || 'مستخدم')}</b><small>${esc(c.emails?.[o] || '')}</small></div></div>
      <div class="chcard-bot"><span class="bal ${balClass(b)}"><span class="num">${fmt(Math.abs(b))}</span> <small style="font-family:var(--font)">د.إ</small></span>
      ${n ? `<span class="tagp">${n} بانتظار تأكيدك</span>` : `<span class="note">${balWord(b)}</span>`}</div></button>`;
  }).join('')}</div>`;
}

/* ---------- الدفتر المشترك داخل القناة ---------- */
export function openChannel(cid) {
  if (!state.channels.some(c => c.id === cid)) return;
  state.openChannel = cid; showErr('eErr'); $('entryForm').reset();
  renderChannelModal(); openModal('chModal');
}

function renderChannelModal() {
  const c = state.channels.find(x => x.id === state.openChannel); if (!c) return;
  const o = otherId(c), b = balanceCents(c.id);
  $('chTitle').textContent = c.names?.[o] || 'مستخدم'; $('chSub').textContent = c.emails?.[o] || '';
  $('chBal').textContent = fmt(Math.abs(b)); $('chBal').className = `bal num ${balClass(b)}`;
  $('chPill').textContent = balWord(b);

  const list = entriesOf(c.id);
  if (!list.length) { $('entriesList').innerHTML = `<div class="empty"><i class="fa-regular fa-folder-open"></i>لا توجد معاملات بعد في هذه القناة.</div>`; return; }
  let html = '', last = null;
  for (const e of list) {
    const k = dayKey(e.createdAt);
    if (k !== last) { html += `<div class="day">${esc(dayLabel(e.createdAt))}</div>`; last = k; }
    const mine = e.creatorUid === me();
    const positive = (e.type === 'subtract' ? -1 : 1) * (mine ? 1 : -1) > 0;   // منظور المستخدم الحالي
    const st = e.status === 'confirmed' ? 'approved' : e.status;
    const label = e.status === 'confirmed' ? 'مؤكدة' : e.status === 'rejected' ? 'مرفوضة' : (mine ? 'بانتظار تأكيد الطرف الآخر' : 'بانتظار تأكيدك');
    let actions = '';
    if (e.status === 'pending' && !mine) actions = `<button class="btn btn-primary btn-sm" data-e="confirmed" data-id="${esc(e.id)}"><i class="fa-solid fa-check"></i>تأكيد</button><button class="btn btn-soft btn-sm" data-e="rejected" data-id="${esc(e.id)}"><i class="fa-solid fa-xmark"></i>رفض</button>`;
    if (e.status === 'pending' && mine) actions = `<button class="btn btn-soft btn-sm" data-e="withdraw" data-id="${esc(e.id)}"><i class="fa-solid fa-rotate-left"></i>سحب</button>`;
    html += `<article class="tx ${positive ? 'add' : 'sub'}"><div class="tx-ic"><i class="fa-solid ${positive ? 'fa-arrow-down' : 'fa-arrow-up'}"></i></div>
      <div class="tx-main">${e.notes ? `<div class="tx-ref">${esc(e.notes)}</div>` : '<div class="tx-ref">معاملة</div>'}
      <div class="tx-meta">${mine ? 'أنت' : esc(e.creatorName)} · ${esc(timeStr(e.createdAt))}</div></div>
      <div class="tx-side"><span class="tx-amt num">${positive ? '+' : '−'}${fmt(toCents(e.amount))}</span><span class="st st-${st}">${label}</span></div>
      ${actions ? `<div class="tx-actions">${actions}</div>` : ''}</article>`;
  }
  $('entriesList').innerHTML = html;
}

async function addEntry(e) {
  e.preventDefault(); showErr('eErr');
  const cid = state.openChannel; if (!cid) return;
  const amount = parseAmount($('eAmount').value), notes = $('eNotes').value.trim();
  const type = document.querySelector('input[name=eType]:checked').value;
  if (!(amount > 0) || amount > 1e9) return showErr('eErr', 'أدخل مبلغاً صحيحاً (حتى خانتين عشريتين).');
  const btn = $('eBtn'); btn.disabled = true;
  try {
    await addDoc(col('channels', cid, 'entries'), {
      creatorUid: me(), creatorName: state.profile.name, type, amount, notes, createdAt: Date.now(), status: 'pending'
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
