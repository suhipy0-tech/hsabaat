// ===== الإشعارات: عدّاد الجرس + لوحة إجراءات سريعة =====
import { state, bus, isOwner } from './state.js';
import { $, esc, openModal, closeModal } from './utils.js';
import { incomingPending, entriesToConfirmCount, confirmList, respondRequest, openChannel } from './channels.js';
import { setUserStatus } from './users.js';
import { pendingTxCount, showPendingFilter } from './ledger.js';

function total() {
  return incomingPending().length + entriesToConfirmCount() + (isOwner() ? state.pendingAccounts.length + pendingTxCount() : 0);
}

function updateBell() {
  const n = total();
  $('bellDot').hidden = !n; $('bellDot').textContent = n > 99 ? '99+' : n;
}

function row(avatar, title, sub, buttons) {
  return `<div class="req"><div class="avatar">${esc(avatar)}</div><div class="grow"><b>${esc(title)}</b><small>${esc(sub)}</small></div><div class="btns">${buttons}</div></div>`;
}

function render() {
  const parts = [];
  const inc = incomingPending();
  if (inc.length) {
    parts.push(`<div class="nsec">طلبات فتح قناة</div>` + inc.map(r => row((r.fromName || '؟').charAt(0), r.fromName, r.fromEmail,
      `<button class="btn btn-primary btn-sm" data-n="acc" data-id="${esc(r.id)}">قبول</button><button class="btn btn-soft btn-sm" data-n="rej" data-id="${esc(r.id)}">رفض</button>`)).join(''));
  }
  const conf = confirmList();
  if (conf.length) {
    parts.push(`<div class="nsec">معاملات بانتظار تأكيدك</div>` + conf.map(({ channel, n }) => {
      const o = channel.members.find(m => m !== state.user.uid);
      return row((channel.names?.[o] || '؟').charAt(0), channel.names?.[o] || 'مستخدم', `${n} معاملة`,
        `<button class="btn btn-primary btn-sm" data-n="ch" data-id="${esc(channel.id)}">فتح</button>`);
    }).join(''));
  }
  if (isOwner() && state.pendingAccounts.length) {
    parts.push(`<div class="nsec">حسابات جديدة بانتظار موافقتك</div>` + state.pendingAccounts.map(u => row((u.name || '؟').charAt(0), u.name, u.email,
      `<button class="btn btn-primary btn-sm" data-n="uok" data-id="${esc(u.id)}">موافقة</button><button class="btn btn-soft btn-sm" data-n="urej" data-id="${esc(u.id)}">رفض</button>`)).join(''));
  }
  if (isOwner() && pendingTxCount()) {
    parts.push(`<div class="nsec">الدفتر</div>` + row('#', `${pendingTxCount()} معاملة بانتظار المراجعة`, 'من المُدخلين',
      `<button class="btn btn-primary btn-sm" data-n="txs">عرض</button>`));
  }
  $('notifBody').innerHTML = parts.join('') || `<div class="empty"><i class="fa-regular fa-bell"></i>لا توجد إشعارات جديدة.</div>`;
}

export function initNotifications() {
  $('bell').onclick = () => { render(); openModal('notifModal'); };
  bus.on('badges', () => { updateBell(); if (!$('notifModal').hidden) render(); });

  $('notifBody').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-n]'); if (!b) return;
    const id = b.dataset.id;
    switch (b.dataset.n) {
      case 'acc': await respondRequest(id, true); break;
      case 'rej': await respondRequest(id, false); break;
      case 'uok': await setUserStatus(id, 'active'); break;
      case 'urej': await setUserStatus(id, 'rejected'); break;
      case 'txs': closeModal('notifModal'); bus.emit('nav', 'ledger'); showPendingFilter(); break;
      case 'ch': closeModal('notifModal'); bus.emit('nav', 'channels'); openChannel(id); break;
    }
  });
}
