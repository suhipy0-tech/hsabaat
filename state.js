// ===== الحالة المشتركة + ناقل أحداث بسيط للتواصل بين الوحدات =====
export const state = {
  // الجلسة
  user: null,            // مستخدم Firebase Auth
  profile: null,         // مستند المستخدم في Firestore
  access: 'none',        // none | active
  setupDone: null,       // هل أُنشئ المالك الأول؟
  settingUp: false,      // أثناء إنشاء حساب جديد
  view: 'ledger',

  // الدفتر
  tx: [], txLoaded: false, shownNet: 0, editingId: null,
  f: { status: 'all', type: 'all', period: 'all', q: '' },

  // الإدارة
  pendingAccounts: [],

  // القنوات
  incoming: [], outgoing: [], channels: [], entries: {}, chLoaded: false, openChannel: null
};

export const isOwner = () => state.access === 'active' && state.profile?.role === 'owner';

const handlers = {};
export const bus = {
  on(event, fn) { (handlers[event] ||= []).push(fn); },
  emit(event, data) {
    (handlers[event] || []).forEach(fn => { try { fn(data); } catch (err) { console.error(`[bus:${event}]`, err); } });
  }
};
