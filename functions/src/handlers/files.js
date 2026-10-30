// Fotot për PDF-të (oferta): shfletuesi nuk mund t'i lexojë direkt nga Storage pa CORS,
// prandaj serveri i kthen si base64. Lejohen vetëm fotot e artikujve, ofertave dhe katalogut.

import { getStorage } from 'firebase-admin/storage';
import { onCall } from 'firebase-functions/v2/https';

import { REGION, fail, userContext } from '../lib/context.js';

const ALLOWED = /^(products|offers|catalog)\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/;
const MAX_TOTAL = 6 * 1024 * 1024; // përgjigjja (base64, +33%) duhet të mbetet nën 10 MB; shfletuesi kërkon me grupe

export const loadImages = onCall({ region: REGION, memory: '512MiB' }, async (request) => {
  await userContext(request);
  const paths = [...new Set((request.data?.paths || []).map(String))].slice(0, 40);
  if (paths.some((p) => !ALLOWED.test(p))) fail('Rrugë e palejuar.', 'invalid-argument');
  const bucket = getStorage().bucket();
  const out = {};
  let total = 0;
  for (const p of paths) {
    try {
      const file = bucket.file(p);
      const [[buf], [md]] = await Promise.all([file.download(), file.getMetadata()]);
      if (total + buf.length > MAX_TOTAL) break;
      total += buf.length;
      out[p] = { type: md.contentType || 'image/jpeg', data: buf.toString('base64') };
    } catch {
      // foto që mungon: thjesht nuk del në PDF
    }
  }
  return out;
});
