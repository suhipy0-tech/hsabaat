// ===== نقطة البداية: ربط الوحدات ببعضها =====
import { state, bus, isOwner } from './state.js';
import { $, initModals, initTheme, toast, openModal, showErr } from './utils.js';
import { initAuth, doSignOut, updateVerifyBar } from './auth.js';
import { initLedgerUI, startLedger, stopLedger } from './ledger.js';
import { initUsersUI, openUsersModal } from './users.js';
import { initChannelsUI, startChannels, stopChannels } from './channels.js';
import { initStatements } from './statements.js';
import { initExport, openExport } from './exporter.js';
import { initNotifications } from './notifications.js';
import { initBackGuard } from './backguard.js';

/* ---------- التنقل بين الأقسام ---------- */
function setView(v) {
  state.view = v;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.dataset.view === v));
  $('view-ledger').hidden = v !== 'ledger';
  $('view-channels').hidden = v !== 'channels';
  $('fab').hidden = v !== 'ledger';
  document.querySelector('main').classList.toggle('wide', v === 'channels');   // صفحة القنوات أوسع
}

/* ---------- الهيدر والقائمة ---------- */
function chrome() {
  const p = state.profile, owner = isOwner();
  $('hello').textContent = `مرحباً، ${p.name}`;
  $('avatarBtn').textContent = (p.name || '؟').trim().charAt(0);
  $('mName').textContent = p.name; $('mEmail').textContent = p.email || state.user.email;
  $('mRole').textContent = owner ? 'مالك (أدمن)' : 'مُدخل بيانات';
  $('mUsers').hidden = !owner;
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
  $('mPass').onclick = () => {
    closeMenu(); showErr('pErr'); $('pOk').hidden = true;
    $('pEmail').textContent = state.user?.email || ''; openModal('passModal');
  };
  $('mUsers').onclick = () => { closeMenu(); openUsersModal(); };
  $('mExport').onclick = () => { closeMenu(); openExport(); };
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => setView(t.dataset.view)));
}

/* ---------- ربط الأحداث بين الوحدات ---------- */
bus.on('session:start', () => { chrome(); setView('ledger'); startLedger(); startChannels(); });
bus.on('session:stop', () => { stopLedger(); stopChannels(); closeMenu(); });
bus.on('profile:changed', chrome);
bus.on('verify:changed', () => { updateVerifyBar(); startChannels(); });
bus.on('nav', setView);

/* ---------- التشغيل ---------- */
initTheme();
initModals();
initLedgerUI();
initUsersUI();
initChannelsUI();
initStatements();
initExport();
initNotifications();
initMenu();
initBackGuard();
initAuth();   // آخراً: بعد تسجيل كل المستمعين

addEventListener('offline', () => toast('أنت غير متصل. ستُحفظ التغييرات وتتزامن لاحقاً.', 'bad'));
addEventListener('online', () => toast('عاد الاتصال'));
