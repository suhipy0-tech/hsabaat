// ===== إدارة المستخدمين (للأدمن): إنشاء حسابات، الأدوار، الإيقاف، الحذف =====
// التسجيل مفتوح للجميع ويعمل مباشرة (بلا موافقة مسبقة)، والأدمن يتحكم بعد ذلك.
import {
  col, dref, getSecondaryAuth, createUserWithEmailAndPassword, updateProfile, sendEmailVerification, signOut,
  sendPasswordResetEmail, getDocs, setDoc, updateDoc, deleteDoc, auth
} from './firebase.js';
import { state, isOwner } from './state.js';
import {
  $, esc, toast, showErr, errMsg, openModal, confirmDialog, cleanName, isFourPartName, isEmail, passwordIssue, shortDate
} from './utils.js';

export async function openUsersModal() {
  if (!isOwner()) return;
  showErr('uErr'); openModal('usersModal'); await refreshUsers();
}

async function refreshUsers() {
  const box = $('usersList');
  box.innerHTML = '<div class="skel" style="height:52px"></div>';
  try {
    const snap = await getDocs(col('users')), users = [];
    // تجاهل سجلات النظام القديم (بلا بريد). أي حالة غير "rejected" تُعتبر نشطة.
    snap.forEach(d => { const v = d.data(); if (v.email) users.push({ id: d.id, ...v, status: v.status === 'rejected' ? 'rejected' : 'active' }); });
    users.sort((a, b) => (a.status === 'rejected') - (b.status === 'rejected') || (b.createdAt || 0) - (a.createdAt || 0));
    $('usersCount').textContent = `${users.length} مستخدم`;
    box.innerHTML = users.map(u => {
      const self = u.id === state.user.uid, id = esc(u.id), btns = [];
      if (u.status === 'rejected') btns.push(`<button class="btn btn-primary btn-sm" data-ua="active" data-id="${id}">إعادة تفعيل</button>`);
      else if (!self) btns.push(
        `<button class="btn btn-soft btn-sm" data-ua="role" data-id="${id}" data-role="${u.role}">${u.role === 'owner' ? 'جعله مُدخلاً' : 'جعله أدمن'}</button>`,
        `<button class="ghost-ic" data-ua="rejected" data-id="${id}" title="إيقاف الحساب"><i class="fa-solid fa-user-slash"></i></button>`);
      if (u.status === 'active') btns.push(`<button class="ghost-ic" data-ua="reset" data-email="${esc(u.email)}" title="إرسال رابط إعادة تعيين كلمة المرور"><i class="fa-solid fa-envelope"></i></button>`);
      if (!self) btns.push(`<button class="ghost-ic" data-ua="del" data-id="${id}" data-name="${esc(u.name)}" title="حذف"><i class="fa-solid fa-trash-can"></i></button>`);
      return `<div class="user-row"><div class="avatar">${esc((u.name || '؟').charAt(0))}</div>
        <div class="grow"><b>${esc(u.name)}${u.role === 'owner' ? '<span class="role">مالك</span>' : ''}${u.status === 'rejected' ? '<span class="role rejected">موقوف</span>' : ''}${self ? ' <small>(أنت)</small>' : ''}</b>
        <small>${esc(u.email)}${u.createdAt ? ' · انضم ' + esc(shortDate(u.createdAt)) : ''}</small></div>
        <div class="btns">${btns.join('')}</div></div>`;
    }).join('') || '<p class="note">لا توجد حسابات.</p>';
  } catch (err) { console.error(err); box.innerHTML = `<div class="err">${esc(errMsg(err))}</div>`; }
}

async function onListClick(e) {
  const b = e.target.closest('[data-ua]'); if (!b || !isOwner()) return;
  const act = b.dataset.ua, id = b.dataset.id;
  try {
    if (act === 'active' || act === 'rejected') {
      if (act === 'rejected' && !(await confirmDialog({ title: 'إيقاف الحساب', message: 'سيفقد المستخدم الوصول فوراً، ويمكنك إعادة تفعيله لاحقاً.', okText: 'إيقاف', danger: true }))) return;
      await updateDoc(dref('users', id), { status: act, reviewedBy: state.user.uid, reviewedAt: Date.now() });
      toast(act === 'active' ? 'تمت إعادة تفعيل الحساب' : 'تم إيقاف الحساب');
    } else if (act === 'role') {
      const next = b.dataset.role === 'owner' ? 'submitter' : 'owner';
      await updateDoc(dref('users', id), { role: next }); toast('تم تغيير الدور');
    } else if (act === 'reset') {
      await sendPasswordResetEmail(auth, b.dataset.email); toast('أُرسل رابط إعادة التعيين');
    } else if (act === 'del') {
      if (!(await confirmDialog({ title: 'حذف المستخدم', message: `سيُحذف سجل (${b.dataset.name}). لمنعه نهائياً من التسجيل مجدداً استخدم «إيقاف الحساب» بدل الحذف.`, okText: 'حذف', danger: true }))) return;
      await deleteDoc(dref('users', id)); toast('تم حذف المستخدم');
    }
    refreshUsers();
  } catch (err) { console.error(err); toast(errMsg(err), 'bad'); }
}

async function onAddUser(e) {
  e.preventDefault(); showErr('uErr');
  if (!isOwner()) return;
  const name = cleanName($('uName').value), email = $('uEmail').value.trim().toLowerCase(), pass = $('uPass').value, role = $('uRole').value;
  if (!isFourPartName(name)) return showErr('uErr', 'أدخل الاسم الرباعي كاملاً (أربع كلمات على الأقل).');
  if (!isEmail(email)) return showErr('uErr', 'أدخل بريداً إلكترونياً صحيحاً.');
  const issue = passwordIssue(pass); if (issue) return showErr('uErr', issue);
  const btn = $('uBtn'); btn.disabled = true;
  try {
    const sa = getSecondaryAuth();                       // جلسة منفصلة كي لا يخرج المالك
    const cred = await createUserWithEmailAndPassword(sa, email, pass);
    await updateProfile(cred.user, { displayName: name });
    try { await sendEmailVerification(cred.user); } catch (err) { console.warn(err); }
    await signOut(sa);
    await setDoc(dref('users', cred.user.uid), { name, email: cred.user.email, role, status: 'active', createdAt: Date.now(), createdBy: state.user.uid });
    $('userForm').reset(); toast(`تم إنشاء حساب ${name}`); refreshUsers();
  } catch (err) { console.error(err); showErr('uErr', errMsg(err)); }
  finally { btn.disabled = false; }
}

export function initUsersUI() {
  $('usersList').addEventListener('click', onListClick);
  $('userForm').addEventListener('submit', onAddUser);
}
