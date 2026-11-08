// ===== نقطة البداية: ربط الوحدات ببعضها =====
import { state, bus, isOwner } from './state.js';
import { $, initModals, initTheme, toast, openModal, showErr } from './utils.js';
import { initAuth, doSignOut, usesPassword, updateVerifyBar } from './auth.js';
import { initLedgerUI, startLedger, stopLedger, exportCsv } from './ledger.js';
import { initUsersUI, startUsers, stopUsers, openUsersModal } from './users.js';
import { initChannelsUI, startChannels, stopChannels } from './channels.js';
import { initNotifications } from './notifications.js';

/* ---------- التنقل بين الأقسام ---------- */
function setView(v) {
  state.view = v;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.dataset.view === v));
  $('view-ledger').hidden = v !== 'ledger';
  $('view-channels').hidden = v !== 'channels';
  $('fab').hidden = v !== 'ledger';
}

/* ---------- الهيدر والقائمة ---------- */
function chrome() {
  const p = state.profile, owner = isOwner();
  $('hello').textContent = `مرحباً، ${p.name}`;
  $('avatarBtn').textContent = (p.name || '؟').trim().charAt(0);
  $('mName').textContent = p.name; $('mEmail').textContent = p.email || state.user.email;
  $('mRole').textContent = owner ? 'مالك (أدمن)' : 'مُدخل بيانات';
  $('mUsers').hidden = !owner; $('mExport').hidden = !owner; $('mPass').hidden = !usesPassword();
  $('fab').querySelector('span').textContent = owner ? 'معاملة جديدة' : 'إرسال معاملة';
  updateVerifyBar();
}

function closeMenu() { $('menu').hidden = true; $('avatarBtn').setAttribute('aria-expanded', 'false'); }

function initMenu() {
  $('avatarBtn').onclick = (e) => {
    e.stopPropagation();
    const open = $('menu').hidden; $('menu').hidden = !open; $('avatarBtn').setAttribute('aria-expanded', String(open));
  };
  document.addEventListener('click', (e) => { if (!e.target.closest('#menu')) closeMenu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
  $('mOut').onclick = () => { closeMenu(); doSignOut(); };
  $('mPass').onclick = () => { closeMenu(); $('passForm').reset(); showErr('pErr'); openModal('passModal'); };
  $('mUsers').onclick = () => { closeMenu(); openUsersModal(); };
  $('mExport').onclick = () => { closeMenu(); exportCsv(); };
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => setView(t.dataset.view)));
}

/* ---------- ربط الأحداث بين الوحدات ---------- */
bus.on('session:start', () => {
  chrome(); setView('ledger');
  startLedger(); startUsers(); startChannels();
});
bus.on('session:stop', () => { stopLedger(); stopUsers(); stopChannels(); closeMenu(); });
bus.on('profile:changed', chrome);
bus.on('verify:changed', () => { updateVerifyBar(); startChannels(); });
bus.on('nav', setView);

/* ---------- التشغيل ---------- */
initTheme();
initModals();
initLedgerUI();
initUsersUI();
initChannelsUI();
initNotifications();
initMenu();
initAuth();   // آخراً: بعد تسجيل كل المستمعين

addEventListener('offline', () => toast('أنت غير متصل. ستُحفظ التغييرات وتتزامن لاحقاً.', 'bad'));
addEventListener('online', () => toast('عاد الاتصال'));
