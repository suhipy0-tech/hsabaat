// ===== الدفتر الرئيسي: المعاملات، الرصيد، الرسم، التصفية =====
import { col, dref, db, onSnapshot, query, where, addDoc, updateDoc, deleteDoc, writeBatch } from './firebase.js';
import { state, bus, isOwner } from './state.js';
import {
  $, esc, fmt, toCents, parseAmount, toast, showErr, errMsg, openModal, closeModal, confirmDialog,
  reduceMotion, dayKey, dayLabel, timeStr
} from './utils.js';

const CATEGORIES = ['تحويل', 'دفعة', 'سلفة', 'سداد', 'أخرى'];
const STATUS = { pending: 'قيد الانتظار', approved: 'مقبول', rejected: 'مرفوض' };
let unsub = null;

/* ---------- التشغيل والإيقاف ---------- */
export function startLedger() {
  stopLedger();
  state.tx = []; state.txLoaded = false; state.shownNet = 0; resetFilters(); renderAll();
  const q = isOwner() ? col('transactions') : query(col('transactions'), where('uid', '==', state.user.uid));
  unsub = onSnapshot(q, (snap) => {
    const list = []; snap.forEach(d => list.push({ id: d.id, ...d.data() }));
    list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    state.tx = list; state.txLoaded = true; renderAll();
  }, (err) => { console.error(err); toast(errMsg(err), 'bad'); state.txLoaded = true; renderAll(); });
}
export function stopLedger() {
  if (unsub) { unsub(); unsub = null; }
  state.tx = []; state.txLoaded = false; state.editingId = null; renderAll();
}
export const pendingTxCount = () => isOwner() ? state.tx.filter(t => (t.status || 'pending') === 'pending').length : 0;

function resetFilters() {
  state.f = { status: 'all', type: 'all', period: 'all', q: '' };
  $('q').value = ''; $('fType').value = 'all'; $('fPeriod').value = 'all';
}
export function showPendingFilter() {
  state.f.status = 'pending'; renderChips(); renderList(); $('list').scrollIntoView({ block: 'start' });
}

/* ---------- الحسابات ---------- */
function totals() {
  let net = 0, add = 0, sub = 0, pend = 0;
  for (const t of state.tx) {
    const c = toCents(t.amount || 0), st = t.status || 'pending';
    if (st === 'approved') { if (t.type === 'subtract') { sub += c; net -= c; } else { add += c; net += c; } }
    else if (st === 'pending') pend += c * (t.type === 'subtract' ? -1 : 1);
  }
  return { net, add, sub, pend };
}

function animateNumber(el, from, to) {
  if (reduceMotion || from === to) { el.textContent = fmt(Math.abs(to)); return; }
  const t0 = performance.now(), dur = 700;
  const step = (now) => {
    const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    el.textContent = fmt(Math.abs(Math.round(from + (to - from) * e)));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ---------- العرض ---------- */
function renderHero() {
  const { net, add, sub, pend } = totals();
  animateNumber($('heroNum'), state.shownNet, net); state.shownNet = net;
  const pill = $('heroPill');
  if (net > 0) { pill.className = 'pill pill-lak'; pill.textContent = 'لك'; }
  else if (net < 0) { pill.className = 'pill pill-alaik'; pill.textContent = 'عليك'; }
  else { pill.className = 'pill pill-even'; pill.textContent = 'متعادل'; }
  $('sumAdd').textContent = fmt(add); $('sumSub').textContent = fmt(sub);
  $('sumPend').textContent = (pend < 0 ? '-' : '') + fmt(Math.abs(pend));
  const approved = state.tx.filter(t => t.status === 'approved').length;
  $('heroSub').textContent = approved ? `محسوب من ${approved} معاملة مقبولة` : (state.txLoaded ? 'لا توجد معاملات مقبولة بعد' : '');
}

function renderChart() {
  const now = new Date(), months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleDateString('ar', { month: 'short' }), g: 0, l: 0 });
  }
  for (const t of state.tx) {
    if (t.status !== 'approved' || !t.createdAt) continue;
    const d = new Date(t.createdAt), m = months.find(x => x.key === `${d.getFullYear()}-${d.getMonth()}`);
    if (m) { if (t.type === 'subtract') m.l += toCents(t.amount); else m.g += toCents(t.amount); }
  }
  const max = Math.max(1, ...months.map(m => Math.max(m.g, m.l)));
  if (months.every(m => !m.g && !m.l)) { $('chart').innerHTML = `<div class="empty-chart">ستظهر هنا حركة الإضافات والخصومات<br>بعد اعتماد أول معاملة.</div>`; return; }
  $('chart').innerHTML = `<div class="chart">${months.map(m => `
    <div class="col" title="إضافات ${fmt(m.g)} — خصومات ${fmt(m.l)}">
      <div class="bars"><div class="bar g" style="height:${Math.round(m.g / max * 100)}%"></div><div class="bar l" style="height:${Math.round(m.l / max * 100)}%"></div></div>
      <small>${esc(m.label)}</small></div>`).join('')}</div>`;
}

function periodOk(t) {
  const p = state.f.period; if (p === 'all') return true;
  if (!t.createdAt) return false;
  const d = new Date(t.createdAt), n = new Date();
  if (p === 'month') return d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear();
  return Date.now() - t.createdAt <= 30 * 864e5;
}
function filtered(ignoreStatus) {
  const { status, type, q } = state.f, qq = q.trim().toLowerCase();
  return state.tx.filter(t => {
    if (!ignoreStatus && status !== 'all' && (t.status || 'pending') !== status) return false;
    if (type !== 'all' && (t.type === 'subtract' ? 'subtract' : 'add') !== type) return false;
    if (!periodOk(t)) return false;
    if (qq && ![t.reference, t.notes, t.submittedBy, t.category].some(v => String(v || '').toLowerCase().includes(qq))) return false;
    return true;
  });
}

function renderChips() {
  const base = filtered(true);
  const count = (s) => s === 'all' ? base.length : base.filter(t => (t.status || 'pending') === s).length;
  $('statusChips').innerHTML = [['all', 'الكل'], ['pending', 'قيد الانتظار'], ['approved', 'مقبول'], ['rejected', 'مرفوض']]
    .map(([k, l]) => `<button class="chip ${state.f.status === k ? 'on' : ''}" data-s="${k}">${l}<b>${count(k)}</b></button>`).join('');
}

function txHTML(t) {
  const sub = t.type === 'subtract', st = t.status || 'pending', id = esc(t.id);
  const time = t.createdAt ? timeStr(t.createdAt) : (t.time || '');
  const own = t.uid && t.uid === state.user?.uid;
  let actions = '';
  if (isOwner()) {
    actions = `${st !== 'approved' ? `<button class="btn btn-primary btn-sm" data-a="approve" data-id="${id}"><i class="fa-solid fa-check"></i>موافقة</button>` : ''}
      ${st !== 'rejected' ? `<button class="btn btn-soft btn-sm" data-a="reject" data-id="${id}"><i class="fa-solid fa-xmark"></i>رفض</button>` : ''}
      <button class="ghost-ic" data-a="edit" data-id="${id}" aria-label="تعديل"><i class="fa-solid fa-pen"></i></button>
      <button class="ghost-ic" data-a="delete" data-id="${id}" aria-label="حذف"><i class="fa-solid fa-trash-can"></i></button>`;
  } else if (own && st === 'pending') {
    actions = `<button class="btn btn-soft btn-sm" data-a="withdraw" data-id="${id}"><i class="fa-solid fa-rotate-left"></i>سحب الطلب</button>`;
  }
  return `<article class="tx ${sub ? 'sub' : 'add'}">
    <div class="tx-ic"><i class="fa-solid ${sub ? 'fa-arrow-up' : 'fa-arrow-down'}"></i></div>
    <div class="tx-main">
      <div class="tx-ref"><span class="ref">${esc(t.reference)}</span>${t.category ? `<span class="tx-cat">${esc(t.category)}</span>` : ''}</div>
      ${t.notes ? `<div class="tx-note" title="${esc(t.notes)}">${esc(t.notes)}</div>` : ''}
      <div class="tx-meta">${esc(t.submittedBy || 'غير محدد')} · ${esc(time)}</div>
    </div>
    <div class="tx-side"><span class="tx-amt num">${sub ? '−' : '+'}${fmt(toCents(t.amount || 0))}</span><span class="st st-${st}">${STATUS[st]}</span></div>
    ${actions ? `<div class="tx-actions">${actions}</div>` : ''}
  </article>`;
}

function renderList() {
  const list = $('list');
  if (!state.txLoaded) { list.innerHTML = '<div class="skel"></div><div class="skel"></div><div class="skel"></div>'; $('counter').textContent = ''; return; }
  const rows = filtered(false), total = state.tx.length;
  $('counter').textContent = rows.length === total ? `${total} معاملة` : `${rows.length} من ${total}`;
  if (!rows.length) {
    list.innerHTML = total
      ? `<div class="empty"><i class="fa-solid fa-filter-circle-xmark"></i>لا توجد نتائج مطابقة.<br><button class="link" id="clearF">مسح التصفية</button></div>`
      : `<div class="empty"><i class="fa-regular fa-folder-open"></i>لا توجد معاملات بعد.<br>اضغط «${isOwner() ? 'معاملة جديدة' : 'إرسال معاملة'}» لتبدأ.</div>`;
    return;
  }
  let html = '', last = null;
  for (const t of rows) {
    const k = dayKey(t.createdAt);
    if (k !== last) { html += `<div class="day">${esc(dayLabel(t.createdAt))}</div>`; last = k; }
    html += txHTML(t);
  }
  list.innerHTML = html;
}

function renderBulk() {
  const n = pendingTxCount();
  $('bulk').hidden = !(isOwner() && n > 1);
  if (n > 1) $('bulkText').textContent = `لديك ${n} طلبات بانتظار المراجعة`;
}

function renderAll() { renderHero(); renderChart(); renderChips(); renderList(); renderBulk(); bus.emit('badges'); }

/* ---------- الإجراءات ---------- */
async function setStatus(id, status) {
  if (!isOwner()) return;
  const t = state.tx.find(x => x.id === id), prev = t?.status || 'pending';
  try {
    await updateDoc(dref('transactions', id), { status, reviewedBy: state.profile.name, reviewedAt: Date.now() });
    toast(status === 'approved' ? 'تم قبول المعاملة' : 'تم رفض المعاملة', 'ok', {
      label: 'تراجع', run: () => updateDoc(dref('transactions', id), { status: prev }).catch(() => toast('تعذر التراجع', 'bad'))
    });
  } catch (err) { console.error(err); toast(errMsg(err), 'bad'); }
}

async function approveAll() {
  const pend = state.tx.filter(t => (t.status || 'pending') === 'pending');
  if (!pend.length) return;
  if (!(await confirmDialog({ title: 'اعتماد الكل', message: `سيتم قبول ${pend.length} معاملة معلّقة. تأكد من مراجعتها.`, okText: 'اعتماد الكل' }))) return;
  try {
    for (let i = 0; i < pend.length; i += 400) {
      const b = writeBatch(db);
      pend.slice(i, i + 400).forEach(t => b.update(dref('transactions', t.id), { status: 'approved', reviewedBy: state.profile.name, reviewedAt: Date.now() }));
      await b.commit();
    }
    toast(`تم قبول ${pend.length} معاملة`);
  } catch (err) { console.error(err); toast(errMsg(err), 'bad'); }
}

async function removeTx(id, title, message, okText, doneMsg) {
  if (!(await confirmDialog({ title, message, okText, danger: true }))) return;
  try { await deleteDoc(dref('transactions', id)); toast(doneMsg); } catch (err) { console.error(err); toast(errMsg(err), 'bad'); }
}

const genRef = () => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${Math.floor(1000 + Math.random() * 9000)}`; };

export function openTx(id) {
  state.editingId = id || null; showErr('txErr'); $('txForm').reset();
  if (id) {
    const t = state.tx.find(x => x.id === id); if (!t) return;
    document.querySelector(`input[name=txType][value=${t.type === 'subtract' ? 'subtract' : 'add'}]`).checked = true;
    $('txAmount').value = t.amount; $('txRef').value = t.reference; $('txNotes').value = t.notes || '';
    const c = document.querySelector(`input[name=txCat][value="${t.category || ''}"]`); if (c) c.checked = true;
    $('txTitle').textContent = 'تعديل المعاملة'; $('txBtn').querySelector('span').textContent = 'حفظ التغييرات';
  } else {
    $('txTitle').textContent = isOwner() ? 'معاملة جديدة' : 'إرسال معاملة للمراجعة';
    $('txBtn').querySelector('span').textContent = isOwner() ? 'حفظ واعتماد' : 'إرسال';
    $('txRef').value = genRef();
  }
  openModal('txModal');
}

async function submitTx(e) {
  e.preventDefault(); showErr('txErr');
  const type = document.querySelector('input[name=txType]:checked').value;
  const category = document.querySelector('input[name=txCat]:checked').value;
  const amount = parseAmount($('txAmount').value), reference = $('txRef').value.trim(), notes = $('txNotes').value.trim();
  if (!(amount > 0)) return showErr('txErr', 'أدخل مبلغاً صحيحاً (حتى خانتين عشريتين).');
  if (amount > 1e9) return showErr('txErr', 'المبلغ كبير جداً.');
  if (reference.length < 4) return showErr('txErr', 'رقم المعاملة يجب ألا يقل عن 4 محارف.');
  const dup = state.tx.some(t => t.reference === reference && t.id !== state.editingId);
  if (dup && !(await confirmDialog({ title: 'رقم مكرر', message: 'توجد معاملة بنفس هذا الرقم. هل تريد المتابعة؟', okText: 'متابعة' }))) return;

  const btn = $('txBtn'); btn.disabled = true;
  try {
    if (state.editingId) {
      if (!isOwner()) return;
      await updateDoc(dref('transactions', state.editingId), { type, amount, reference, notes, category, updatedBy: state.profile.name, updatedAt: Date.now() });
      toast('تم حفظ التعديلات');
    } else {
      await addDoc(col('transactions'), {
        type, amount, reference, notes, category, createdAt: Date.now(),
        status: isOwner() ? 'approved' : 'pending', submittedBy: state.profile.name, uid: state.user.uid
      });
      toast(isOwner() ? 'تمت إضافة المعاملة' : 'أُرسلت المعاملة للمراجعة');
    }
    closeModal('txModal');
  } catch (err) { console.error(err); showErr('txErr', errMsg(err)); }
  finally { btn.disabled = false; }
}

export function exportCsv() {
  if (!isOwner()) return;
  const cell = (v) => { let s = String(v ?? ''); if (/^[=+\-@]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };
  const rows = [['التاريخ', 'النوع', 'المبلغ', 'رقم المعاملة', 'التصنيف', 'ملاحظات', 'بواسطة', 'الحالة']];
  for (const t of state.tx) rows.push([t.createdAt ? new Date(t.createdAt).toLocaleString('ar') : `${t.date || ''} ${t.time || ''}`, t.type === 'subtract' ? 'خصم' : 'إضافة', t.amount, t.reference, t.category, t.notes, t.submittedBy, STATUS[t.status || 'pending']]);
  const url = URL.createObjectURL(new Blob(['\ufeff' + rows.map(r => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `transactions-${new Date().toISOString().slice(0, 10)}.csv` });
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  toast('تم تصدير الملف');
}

/* ---------- ربط الأحداث ---------- */
export function initLedgerUI() {
  $('txCats').innerHTML = `<label><input class="sr" type="radio" name="txCat" value="" checked><span>بدون</span></label>` +
    CATEGORIES.map(c => `<label><input class="sr" type="radio" name="txCat" value="${c}"><span>${c}</span></label>`).join('');
  $('txGen').onclick = () => { $('txRef').value = genRef(); };
  $('fab').onclick = () => openTx(null);
  $('txForm').addEventListener('submit', submitTx);
  $('bulkBtn').onclick = approveAll;

  $('q').addEventListener('input', e => { state.f.q = e.target.value; renderChips(); renderList(); });
  $('fType').onchange = e => { state.f.type = e.target.value; renderChips(); renderList(); };
  $('fPeriod').onchange = e => { state.f.period = e.target.value; renderChips(); renderList(); };
  $('statusChips').addEventListener('click', e => {
    const b = e.target.closest('[data-s]'); if (!b) return;
    state.f.status = b.dataset.s; renderChips(); renderList();
  });
  $('list').addEventListener('click', (e) => {
    if (e.target.closest('#clearF')) { resetFilters(); renderChips(); renderList(); return; }
    const b = e.target.closest('[data-a]'); if (!b) return;
    const id = b.dataset.id;
    ({
      approve: () => setStatus(id, 'approved'),
      reject: () => setStatus(id, 'rejected'),
      edit: () => openTx(id),
      delete: () => isOwner() && removeTx(id, 'حذف المعاملة', 'سيتم حذفها نهائياً ولا يمكن التراجع.', 'حذف', 'تم حذف المعاملة'),
      withdraw: () => removeTx(id, 'سحب الطلب', 'سيتم حذف هذا الطلب قبل مراجعته.', 'سحب الطلب', 'تم سحب الطلب')
    })[b.dataset.a]?.();
  });
}
