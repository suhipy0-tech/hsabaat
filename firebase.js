// ===== الاتصال بقاعدة بيانات Firebase + مساعدات المسارات =====
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, getFirestore, collection, doc
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// مفاتيح الربط بمشروعك (ليست سرية؛ الحماية الفعلية عبر قواعد Firestore)
export const firebaseConfig = {
  apiKey: "AIzaSyANa3RmTfNA0CLJWHzipy52LmaVIbs-m1I",
  authDomain: "hsabat-e34d7.firebaseapp.com",
  databaseURL: "https://hsabat-e34d7-default-rtdb.firebaseio.com",
  projectId: "hsabat-e34d7",
  storageBucket: "hsabat-e34d7.firebasestorage.app",
  messagingSenderId: "606297002076",
  appId: "1:606297002076:web:5b11348c81ef4be38b1699",
  measurementId: "G-M1R389FCER"
};

export const APP_ID = 'hsabat-e34d7';
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// تخزين محلي يسمح بالعمل عند انقطاع الإنترنت
export const db = (() => {
  try { return initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }); }
  catch (e) { return getFirestore(app); }
})();

// نفس هيكلية البيانات السابقة: artifacts/<APP_ID>/public/data/...
const BASE = ['artifacts', APP_ID, 'public', 'data'];
export const col = (...path) => collection(db, ...BASE, ...path);
export const dref = (...path) => doc(db, ...BASE, ...path);

// تطبيق ثانوي لإنشاء حسابات المستخدمين دون إخراج المالك من جلسته
let secondary = null;
export function getSecondaryAuth() {
  if (!secondary) secondary = getAuth(initializeApp(firebaseConfig, 'secondary'));
  return secondary;
}

export {
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut,
  sendPasswordResetEmail, sendEmailVerification, updateProfile, updatePassword,
  reauthenticateWithCredential, EmailAuthProvider, GoogleAuthProvider, signInWithPopup,
  signInWithRedirect, setPersistence, browserLocalPersistence, browserSessionPersistence
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

export {
  setDoc, addDoc, updateDoc, deleteDoc, getDoc, getDocs, onSnapshot, query, where, writeBatch, deleteField
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
