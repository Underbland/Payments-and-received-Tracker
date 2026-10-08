// Sign-in (Google, Facebook) and cloud storage (Firestore). Only loaded when src/config.js is filled in.
import { Capacitor } from '@capacitor/core';
import { initializeApp } from 'firebase/app';
import {
  getAuth, initializeAuth, indexedDBLocalPersistence, onAuthStateChanged,
  GoogleAuthProvider, FacebookAuthProvider, signInWithCredential, signInWithPopup, signInWithRedirect, signOut as fbSignOut
} from 'firebase/auth';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, setDoc, deleteDoc, onSnapshot
} from 'firebase/firestore';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { firebaseConfig, providers } from './config.js';

const app = initializeApp(firebaseConfig);
const native = Capacitor.isNativePlatform();
// In the Android app the plugin signs in natively, then hands the result to this web layer.
const auth = native ? initializeAuth(app, { persistence: indexedDBLocalPersistence }) : getAuth(app);
// Keeps working offline and syncs when the connection returns.
const db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });

export { providers };

export function watchAuth(cb) {
  return onAuthStateChanged(auth, (u) => cb(u ? { uid: u.uid, displayName: u.displayName, email: u.email } : null));
}

export async function signIn(which) {
  try {
    if (native) {
      if (which === 'google') {
        const r = await FirebaseAuthentication.signInWithGoogle();
        const idToken = r.credential && r.credential.idToken;
        if (!idToken) throw new Error('missing Google token');
        await signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
      } else {
        const r = await FirebaseAuthentication.signInWithFacebook();
        const token = r.credential && r.credential.accessToken;
        if (!token) throw new Error('missing Facebook token');
        await signInWithCredential(auth, FacebookAuthProvider.credential(token));
      }
    } else {
      const provider = which === 'google' ? new GoogleAuthProvider() : new FacebookAuthProvider();
      try { await signInWithPopup(auth, provider); }
      catch (e) {
        if (e && (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment')) { await signInWithRedirect(auth, provider); return; }
        throw e;
      }
    }
  } catch (e) {
    const msg = String((e && (e.code || e.message)) || '');
    if (/cancel|closed-by-user|popup-closed/i.test(msg)) { const c = new Error('cancelled'); c.cancelled = true; throw c; }
    throw e;
  }
}

export async function signOut() {
  try { if (native) await FirebaseAuthentication.signOut(); } catch (e) {}
  await fbSignOut(auth);
}

// Everything for one person lives under users/<their id>/items (see firestore.rules).
export function cloudStore(uid) {
  const col = collection(db, 'users', uid, 'items');
  const clean = (o) => JSON.parse(JSON.stringify(o));
  return {
    mode: 'db',
    load(cb, onErr) {
      return onSnapshot(col, (snap) => {
        const bills = [], txs = [];
        let settings = { currency: null, lang: null };
        snap.forEach((d) => {
          const v = d.data() || {};
          if (d.id === 'settings') settings = { currency: v.currency || null, lang: v.lang || null };
          else if (v.type === 'tx') txs.push({ ...v, id: d.id });
          else bills.push({ ...v, id: d.id });
        });
        cb(bills, txs, settings);
      }, (err) => { if (onErr) onErr(err); });
    },
    save(item) { const { id, ...rest } = item; return setDoc(doc(col, id), clean(rest)); },
    remove(item) { return deleteDoc(doc(col, item.id)); },
    setSettings(s) { return setDoc(doc(col, 'settings'), clean({ currency: s.currency, lang: s.lang })); }
  };
}
