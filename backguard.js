// ===== حماية زر الرجوع: لا يخرج المستخدم مباشرة، بل يُسأل «هل تريد المغادرة؟» =====
import { closeModal, confirmDialog } from './utils.js';

const GUARD = { ledgerGuard: true };
let armed = false, leaving = false;

// المتصفحات تتجاهل سجلات التاريخ المضافة بلا تفاعل من المستخدم،
// لذلك نُفعّل الحماية عند أول لمسة أو ضغطة.
function arm() {
  if (armed) return;
  armed = true;
  history.pushState(GUARD, '');
}

async function onPop() {
  if (!armed || leaving) return;

  // إن كانت هناك نافذة مفتوحة: الرجوع يغلقها بدل المغادرة
  const open = [...document.querySelectorAll('[data-modal]')].filter(m => !m.hidden).pop();
  if (open) {
    closeModal(open.id);
    history.pushState(GUARD, '');
    return;
  }

  const leave = await confirmDialog({
    title: 'هل تريد المغادرة؟',
    message: 'سيتم الخروج من الصفحة. هل تريد المتابعة؟',
    okText: 'خروج', cancelText: 'بقاء', danger: true
  });

  if (!leave) { history.pushState(GUARD, ''); return; }   // بقاء: نعيد الحاجز

  leaving = true;
  history.back();                                          // خروج: خطوة إضافية خارج الصفحة
  // إن لم يوجد سجل سابق (فُتحت الصفحة مباشرة) نبقى ونعيد تفعيل الحماية
  setTimeout(() => { if (document.visibilityState === 'visible') { leaving = false; history.pushState(GUARD, ''); } }, 600);
}

export function initBackGuard() {
  ['pointerdown', 'touchstart', 'keydown'].forEach(ev => addEventListener(ev, arm, { passive: true }));
  addEventListener('popstate', onPop);
}
