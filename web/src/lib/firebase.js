import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import {
  connectFirestoreEmulator, initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
} from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';
import { connectStorageEmulator, getStorage } from 'firebase/storage';

const env = import.meta.env;
const useEmulators = env.VITE_USE_EMULATORS === 'true';

export const app = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY || 'demo-key',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID || 'superpool-app',
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  appId: env.VITE_FIREBASE_APP_ID,
});

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
    const message = err?.message && !/^internal$/i.test(err.message)
      ? err.message
      : 'Ndodhi një gabim. Provoni përsëri ose kontaktoni administratorin.';
    throw new Error(message);
  }
}
