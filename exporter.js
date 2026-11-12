// ===== تصدير CSV: من قناة معينة أو من جميع القنوات (والدفتر الرئيسي للأدمن) =====
import { state, isOwner } from './state.js';
import { $, esc, toast, showErr, openModal, closeModal } from './utils.js';
import { channelInfo, entriesList } from './channels.js';
import { exportCsv as exportMainLedger } from './ledger.js';

const STATUS = { confirmed: 'مؤكدة', pending: 'معلّقة', rejected: 'مرفوضة' };
const p2 = (n) => String(n).padStart(2, '0');
const dateISO = (ts) => { const d = new Date(ts); return ts ? `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}` : ''; };
const timeHM = (ts) => { const d = new Date(ts); return ts ? `${p2(d.getHours())}:${p2(d.getMinutes())}` : ''; };

function download(rows, name) {
  // حماية من حقن المعادلات في Excel: أي خلية تبدأ بـ = + - @ تُسبق بفاصلة عليا
  const cell = (v) => { let s = String(v ?? ''); if (/^[=+\-@]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };
  const url = URL.createObjectURL(new Blob(['\ufeff' + rows.map(r => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

const HEADER = ['القناة', 'بريد الطرف الآخر', 'التاريخ', 'الوقت', 'رقم المعاملة', 'المبلغ', 'الجهة', 'الحالة', 'ملاحظات'];

function channelRows(c) {
  const i = channelInfo(c);
  return entriesList(c.id).map(e => [
    i.name, i.email, dateISO(e.createdAt), timeHM(e.createdAt), e.reference || '',
    (e.type === 'subtract' ? -1 : 1) * Number(e.amount || 0),
    e.creatorUid === state.user.uid ? 'منك' : 'منه', STATUS[e.status] || e.status, e.notes || ''
  ]);
}

const safeName = (s) => String(s).replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 40);
const today = () => dateISO(Date.now());
const source = () => document.querySelector('input[name=expSrc]:checked')?.value;

function syncUI() {
  $('expChannelWrap').hidden = source() !== 'channel';
  showErr('expErr');
}

export function openExport() {
  const hasCh = state.channels.length > 0, owner = isOwner();
  $('expChannel').innerHTML = state.channels.map(c => { const i = channelInfo(c); return `<option value="${esc(i.id)}">${esc(i.name)} — ${esc(i.email)}</option>`; }).join('');
  $('expAll').disabled = !hasCh; $('expCh').disabled = !hasCh;
  $('expMainRow').hidden = !owner;
  $('expNone').hidden = hasCh || owner;
  $('expBtn').disabled = !hasCh && !owner;
  const first = hasCh ? 'expAll' : (owner ? 'expMain' : 'expAll');
  $(first).checked = true;
  syncUI(); openModal('exportModal');
}

function onSubmit(e) {
  e.preventDefault(); showErr('expErr');
  const src = source();
  if (src === 'main') { closeModal('exportModal'); exportMainLedger(); return; }
  const chosen = src === 'channel' ? state.channels.filter(c => c.id === $('expChannel').value) : state.channels;
  if (!chosen.length) return showErr('expErr', 'اختر قناة للتصدير.');
  const rows = chosen.flatMap(channelRows);
  if (!rows.length) return showErr('expErr', 'لا توجد معاملات للتصدير في هذا الاختيار.');
  const name = src === 'channel' ? `channel-${safeName(channelInfo(chosen[0]).name)}-${today()}.csv` : `all-channels-${today()}.csv`;
  download([HEADER, ...rows], name);
  closeModal('exportModal'); toast(`تم تصدير ${rows.length} معاملة`);
}

export function initExport() {
  $('exportForm').addEventListener('submit', onSubmit);
  document.querySelectorAll('input[name=expSrc]').forEach(r => r.addEventListener('change', syncUI));
}
