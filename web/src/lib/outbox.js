// Radha e dërgimit për punën pa internet (terreni): dokumentet e regjistruara pa lidhje ruhen në telefon
// dhe dërgohen automatikisht kur kthehet interneti. Çdo dokument ka requestId të vetin, kështu që
// serveri nuk e dyfishon edhe nëse dërgohet dy herë.

import { useEffect, useState } from 'react';

import { auth, call } from './firebase.js';

const KEY = 'superpool-outbox';
const listeners = new Set();

function read() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}
function write(items) {
  try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* memorie e plotë / e bllokuar */ }
  listeners.forEach((fn) => fn(items));
}

export const newRequestId = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : `${Date.now()}${Math.random().toString(36).slice(2)}`).slice(0, 32);

function enqueue(name, data, label) {
  const items = read().filter((i) => i.data.requestId !== data.requestId);
  items.push({ id: data.requestId, uid: auth.currentUser?.uid || null, name, data, label, createdAt: new Date().toISOString(), error: '' });
  write(items);
  scheduleFlush();
}

/**
 * Si call(), por nëse nuk ka internet (ose kërkesa nuk arrin te serveri) e ruan në radhë
 * dhe kthen { queued: true }. Gabimet e tjera (p.sh. stok i pamjaftueshëm) hidhen si zakonisht.
 */
export async function callOrQueue(name, data, label) {
  const payload = { ...data, requestId: data.requestId || newRequestId() };
  if (navigator.onLine === false) {
    enqueue(name, payload, label);
    return { queued: true, requestId: payload.requestId };
  }
  try {
    return await call(name, payload);
  } catch (err) {
    if (!err.network) throw err;
    enqueue(name, payload, label);
    return { queued: true, requestId: payload.requestId };
  }
}

let flushing = false;
/** Dërgon dokumentet në radhë, një nga një. Kthen sa u dërguan. */
export async function flushOutbox() {
  if (flushing || navigator.onLine === false) return 0;
  const uid = auth.currentUser?.uid;
  if (!uid) return 0;
  flushing = true;
  let sent = 0;
  try {
    for (const item of read()) {
      if (item.uid && item.uid !== uid) continue;
      try {
        await call(item.name, item.data);
        write(read().filter((i) => i.id !== item.id));
        sent += 1;
      } catch (err) {
        if (err.network) break; // ende pa lidhje — provohet më vonë
        // Gabim i vërtetë (p.sh. stoku nuk mjafton më): mbetet në radhë me mesazhin, për ta parë përdoruesi.
        write(read().map((i) => (i.id === item.id ? { ...i, error: err.message } : i)));
      }
    }
  } finally {
    flushing = false;
  }
  return sent;
}

export function removeFromOutbox(id) {
  write(read().filter((i) => i.id !== id));
}

let timer = null;
function scheduleFlush() {
  if (timer) return;
  timer = setInterval(() => {
    if (!read().some((i) => !i.error)) { clearInterval(timer); timer = null; return; }
    flushOutbox();
  }, 30000);
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { flushOutbox(); });
  if (read().length) scheduleFlush();
}

/** Gjendja e radhës dhe e lidhjes, për ndërfaqen. */
export function useOutbox() {
  const [items, setItems] = useState(read);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    listeners.add(setItems);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    // Sapo hapet aplikacioni me lidhje, dërgo çfarë ka mbetur.
    const t = setTimeout(() => flushOutbox(), 2000);
    return () => {
      listeners.delete(setItems);
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      clearTimeout(t);
    };
  }, []);
  return { items, online };
}
