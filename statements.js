// ===== صفحة الدفتر: الملخص العام + كشف الأموال الشامل + كشف بسيط لكل قناة =====
import { state, bus, isOwner } from './state.js';
import { $, esc, fmt, toCents, shortDate, timeStr } from './utils.js';
import { channelInfo, channelStats, entriesList, openChannel } from './channels.js';

const netClass = (n) => n > 0 ? 'pos' : n < 0 ? 'neg' : 'zero';
const netText = (n) => (n < 0 ? '−' : n > 0 ? '+' : '') + fmt(Math.abs(n));
const cell = (n) => `<span class="num ${netClass(n)}">${netText(n)}</span>`;

/* ---------- إحصاءات الدفتر الرئيسي ---------- */
function mainStats(list) {
  const s = { add: 0, sub: 0, cnt: { approved: 0, pending: 0, rejected: 0 }, total: list.length, first: 0, last: 0, max: 0, sum: 0 };
  for (const t of list) {
    const st = t.status || 'pending'; s.cnt[st] = (s.cnt[st] || 0) + 1;
    const ts = t.createdAt || 0;
    if (ts) { s.first = s.first ? Math.min(s.first, ts) : ts; s.last = Math.max(s.last, ts); }
    if (st !== 'approved') continue;
    const c = toCents(t.amount || 0); s.sum += c; if (c > s.max) s.max = c;
    if (t.type === 'subtract') s.sub += c; else s.add += c;
  }
  s.net = s.add - s.sub; s.avg = s.cnt.approved ? Math.round(s.sum / s.cnt.approved) : 0;
  return s;
}

/* ---------- 1) الملخص العام ---------- */
function renderSummary(m) {
  const tiles = [
    ['إجمالي المعاملات', m.total, 'fa-receipt'],
    ['مقبولة', m.cnt.approved, 'fa-circle-check'],
    ['قيد الانتظار', m.cnt.pending, 'fa-hourglass-half'],
    ['مرفوضة', m.cnt.rejected, 'fa-circle-xmark'],
    ['أول معاملة', m.first ? shortDate(m.first) : '—', 'fa-calendar-plus'],
    ['آخر معاملة', m.last ? shortDate(m.last) : '—', 'fa-calendar-check'],
    ['أكبر مبلغ مقبول', m.max ? fmt(m.max) : '—', 'fa-arrow-up-wide-short'],
    ['متوسط المبلغ', m.avg ? fmt(m.avg) : '—', 'fa-divide']
  ];
  $('summaryGrid').innerHTML = tiles.map(([l, v, ic]) =>
    `<div class="stile"><i class="fa-solid ${ic}"></i><div><small>${l}</small><b class="num">${esc(v)}</b></div></div>`).join('');
}

/* ---------- 2) كشف الأموال الشامل ---------- */
function renderComprehensive(m) {
  const rows = [{ label: 'الدفتر الرئيسي', sub: 'إضافات وخصومات مقبولة', last: m.last, plus: m.add, minus: m.sub, net: m.net }];
  for (const c of state.channels) {
    const i = channelInfo(c), s = channelStats(c.id);
    rows.push({ label: i.name, sub: 'قناة', last: s.last, plus: s.mine, minus: s.theirs, net: s.net });
  }
  const tot = rows.reduce((a, r) => ({ plus: a.plus + r.plus, minus: a.minus + r.minus, net: a.net + r.net }), { plus: 0, minus: 0, net: 0 });
  $('stmtMain').innerHTML = `<div class="tbl-wrap"><table class="tbl">
    <thead><tr><th>المصدر</th><th>آخر حركة</th><th>الإضافات (+)</th><th>الخصومات (−)</th><th>الصافي</th></tr></thead>
    <tbody>${rows.map(r => `<tr><td><b>${esc(r.label)}</b><small>${esc(r.sub)}</small></td><td>${esc(r.last ? shortDate(r.last) : '—')}</td>
      <td class="num">${fmt(r.plus)}</td><td class="num">${fmt(r.minus)}</td><td>${cell(r.net)}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td colspan="2"><b>الإجمالي</b></td><td class="num">${fmt(tot.plus)}</td><td class="num">${fmt(tot.minus)}</td><td>${cell(tot.net)}</td></tr></tfoot>
  </table></div>
  ${state.channels.length ? '<p class="note" style="margin:.6rem 0 0">في القنوات: (+) المُرسَل منك و(−) المُرسَل منه، من المعاملات المؤكدة فقط.</p>' : ''}`;

  // للمالك: توزيع الدفتر الرئيسي حسب الشخص
  const wrap = $('stmtPeopleWrap');
  const byPerson = new Map();
  if (isOwner()) {
    for (const t of state.tx) {
      const key = t.uid || t.submittedBy || '—';
      const p = byPerson.get(key) || { name: t.submittedBy || 'غير محدد', n: 0, add: 0, sub: 0, last: 0 };
      p.n++; p.last = Math.max(p.last, t.createdAt || 0);
      if ((t.status || 'pending') === 'approved') { const c = toCents(t.amount || 0); if (t.type === 'subtract') p.sub += c; else p.add += c; }
      byPerson.set(key, p);
    }
  }
  wrap.hidden = !byPerson.size;
  if (byPerson.size) {
    $('stmtPeople').innerHTML = `<div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>الشخص</th><th>المعاملات</th><th>إضافات</th><th>خصومات</th><th>الصافي</th><th>آخر معاملة</th></tr></thead>
      <tbody>${[...byPerson.values()].sort((a, b) => b.last - a.last).map(p => `<tr><td><b>${esc(p.name)}</b></td><td class="num">${p.n}</td>
        <td class="num">${fmt(p.add)}</td><td class="num">${fmt(p.sub)}</td><td>${cell(p.add - p.sub)}</td><td>${esc(p.last ? shortDate(p.last) : '—')}</td></tr>`).join('')}</tbody></table></div>`;
  }
}

/* ---------- 3) كشف بسيط لكل قناة (تحت اسم صاحب القناة) ---------- */
const ST = { confirmed: ['مؤكدة', 'approved'], pending: ['معلّقة', 'pending'], rejected: ['مرفوضة', 'rejected'] };

function renderChannelStatements() {
  $('chStmtCard').hidden = !state.channels.length;
  if (!state.channels.length) { $('chStmts').innerHTML = ''; return; }
  $('chStmts').innerHTML = state.channels.map(c => {
    const i = channelInfo(c), s = channelStats(c.id), list = entriesList(c.id);
    const recent = list.slice(0, 5);
    const rows = recent.map(e => {
      const mine = e.creatorUid === state.user.uid, [label, cls] = ST[e.status] || ST.pending;
      return `<tr><td>${esc(shortDate(e.createdAt))}<small>${esc(timeStr(e.createdAt))}</small></td>
        <td class="num">${e.reference ? '#' + esc(e.reference) : '—'}</td>
        <td class="num ${mine ? 'pos' : 'neg'}">${fmt(toCents(e.amount))}</td>
        <td>${mine ? 'منك' : 'منه'}</td><td><span class="st st-${cls}">${label}</span></td></tr>`;
    }).join('');
    return `<article class="mini">
      <div class="mini-head"><div class="avatar">${esc(i.name.charAt(0))}</div>
        <div class="grow"><b>${esc(i.name)}</b><small>${esc(i.email)}</small></div>
        <button class="btn btn-soft btn-sm" data-open="${esc(c.id)}">فتح القناة</button></div>
      <div class="stats3"><div><small>المُرسَل منك</small><b class="num">${fmt(s.mine)}</b></div>
        <div><small>المُرسَل منه</small><b class="num">${fmt(s.theirs)}</b></div>
        <div><small>الصافي</small><b class="num ${netClass(s.net)}">${netText(s.net)}</b></div></div>
      ${recent.length
        ? `<div class="tbl-wrap"><table class="tbl tbl-sm"><thead><tr><th>التاريخ</th><th>الرقم</th><th>المبلغ</th><th>الجهة</th><th>الحالة</th></tr></thead><tbody>${rows}</tbody></table></div>
           <p class="note" style="margin:.5rem 0 0">${list.length > recent.length ? `آخر ${recent.length} من ${list.length} معاملة` : `${list.length} معاملة`}</p>`
        : '<p class="note" style="margin:.8rem 0 0;text-align:center">لا توجد معاملات بعد.</p>'}
    </article>`;
  }).join('');
}

/* ---------- التشغيل ---------- */
function render() {
  if (!state.user) { $('summaryGrid').innerHTML = ''; $('stmtMain').innerHTML = ''; $('stmtPeopleWrap').hidden = true; $('chStmtCard').hidden = true; return; }
  const m = mainStats(state.tx);
  renderSummary(m); renderComprehensive(m); renderChannelStatements();
}

export function initStatements() {
  bus.on('ledger:changed', render);
  bus.on('channels:changed', render);
  $('chStmts').addEventListener('click', (e) => { const b = e.target.closest('[data-open]'); if (b) openChannel(b.dataset.open); });
}
