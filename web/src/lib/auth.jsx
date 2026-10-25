import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { ROLES, capsForRole } from '@shared/roles.js';

import { auth, db } from './firebase.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [firebaseUser, setFirebaseUser] = useState(undefined);
  const [profile, setProfile] = useState(undefined);

  useEffect(() => onAuthStateChanged(auth, (u) => {
    setFirebaseUser(u);
    if (!u) setProfile(null);
  }), []);

  useEffect(() => {
    if (!firebaseUser) return undefined;
    setProfile(undefined);
    return onSnapshot(
      doc(db, 'users', firebaseUser.uid),
      (snap) => setProfile(snap.exists() ? { id: snap.id, ...snap.data() } : null),
      () => setProfile(null),
    );
  }, [firebaseUser]);

  const value = useMemo(() => {
    const role = profile?.active ? profile.role : null;
    const caps = capsForRole(role);
    return {
      loading: firebaseUser === undefined || (firebaseUser && profile === undefined),
      firebaseUser,
      profile,
      uid: firebaseUser?.uid || null,
      role,
      roleLabel: ROLES[role] || '',
      caps,
      can: (...c) => c.some((x) => caps.has(x)),
      logout: () => signOut(auth),
    };
  }, [firebaseUser, profile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
