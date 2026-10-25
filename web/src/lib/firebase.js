import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import {
  connectFirestoreEmulator, initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
} from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';
import { connectStorageEmulator, getStorage } from 'firebase/storage';

const env = import.meta.env;
const useEmulators = env.VITE_USE_EMULATORS === 'true';

// Konfigurimi i web app-it "superpool-system". Këto vlera janë publike (shfaqen në çdo aplikacion web Firebase);
// siguria garantohet nga Authentication dhe rregullat e Firestore/Storage. Variablat VITE_* i mbishkruajnë.
const config = {
  apiKey: env.VITE_FIREBASE_API_KEY || 'AIzaSyAIo1H_hQVjPlR-oqmIXix2TfNRAAUJfyk',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || 'superpool-system.firebaseapp.com',
  projectId: env.VITE_FIREBASE_PROJECT_ID || 'superpool-system',
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || 'superpool-system.firebasestorage.app',
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || '495289678465',
  appId: env.VITE_FIREBASE_APP_ID || '1:495289678465:web:d7ccebdc1d5f837a6d2b80',
  measurementId: env.VITE_FIREBASE_MEASUREMENT_ID || 'G-R9P7MYC5JG',
};

export const app = initializeApp(config);

// Google Analytics ngarkohet vetëm në prodhim dhe vetëm kur shfletuesi e mbështet.
if (!useEmulators && import.meta.env.PROD) {
  import('firebase/analytics')
    .then(({ getAnalytics, isSupported }) => isSupported().then((ok) => ok && getAnalytics(app)))
    .catch(() => {});
}

export const auth = getAuth(app);

// Cache lokale: punonjësit në terren shohin të dhënat edhe me sinjal të dobët.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

export const functions = getFunctions(app, env.VITE_FUNCTIONS_REGION || 'europe-west1');
export const storage = getStorage(app);

if (useEmulators) {
  const host = window.location.hostname;
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(db, host, 8080);
  connectFunctionsEmulator(functions, host, 5001);
  connectStorageEmulator(storage, host, 9199);
}

/** Thërret një Cloud Function dhe kthen të dhënat, ose hedh Error me mesazh të lexueshëm. */
export async function call(name, data) {
  try {
    const res = await httpsCallable(functions, name, { timeout: 300000 })(data);
    return res.data;
  } catch (err) {
    // "internal [0]" = kërkesa nuk arriti fare te serveri (funksioni nuk është vendosur, ose nuk ka internet).
    if (err?.code === 'functions/internal' && /\[0\]/.test(err.message || '')) {
      throw new Error(navigator.onLine === false
        ? 'Nuk ka lidhje me internetin.'
        : 'Shërbimi i serverit (Cloud Functions) nuk është i arritshëm. Kontrolloni që funksionet janë vendosur me "npm run deploy".');
    }
    const message = err?.message && !/^internal$/i.test(err.message)
      ? err.message
      : 'Ndodhi një gabim. Provoni përsëri ose kontaktoni administratorin.';
    throw new Error(message);
  }
}
