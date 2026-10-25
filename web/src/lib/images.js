// Fotot e artikujve: zvogëlim në shfletues, ngarkim në Storage dhe lidhje me artikullin.

import { deleteField, doc, updateDoc } from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';

import { db, storage } from './firebase.js';

const loadImage = (blob) => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Skedari nuk është foto e vlefshme.')); };
  img.src = url;
});

/** Kthen një JPEG me anën më të gjatë jo më shumë se `max` piksel. */
export async function resizeImage(blob, max = 1200, quality = 0.85) {
  const img = await loadImage(blob);
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // PNG me sfond transparent → i bardhë
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

/**
 * Ngarkon foton e artikullit (versioni i madh + miniatura) dhe e lidh me artikullin.
 * `source` mund të jetë File/Blob ose ArrayBuffer (p.sh. foto e nxjerrë nga Excel).
 */
export async function uploadProductImage(productId, source, mimeType = 'image/jpeg') {
  const blob = source instanceof Blob ? source : new Blob([source], { type: mimeType });
  const [large, thumb] = await Promise.all([resizeImage(blob, 1200, 0.85), resizeImage(blob, 240, 0.8)]);
  const stamp = Date.now();
  const mainPath = `products/${productId}/${stamp}.jpg`;
  const thumbPath = `products/${productId}/${stamp}_thumb.jpg`;
  const meta = { contentType: 'image/jpeg', cacheControl: 'public, max-age=31536000' };
  await Promise.all([
    uploadBytes(storageRef(storage, mainPath), large, meta),
    uploadBytes(storageRef(storage, thumbPath), thumb, meta),
  ]);
  const [imageUrl, thumbUrl] = await Promise.all([
    getDownloadURL(storageRef(storage, mainPath)),
    getDownloadURL(storageRef(storage, thumbPath)),
  ]);
  const productRef = doc(db, 'products', productId);
  await updateDoc(productRef, { imageUrl, thumbUrl, imagePaths: [mainPath, thumbPath] });
  return { imageUrl, thumbUrl };
}

/** Lidh një foto nga një link i jashtëm (pa e ngarkuar në Storage). */
export const linkProductImage = (productId, url) => updateDoc(doc(db, 'products', productId), {
  imageUrl: url, thumbUrl: url, imagePaths: deleteField(),
});

export async function removeProductImage(product) {
  await Promise.all((product.imagePaths || []).map((p) => deleteObject(storageRef(storage, p)).catch(() => {})));
  await updateDoc(doc(db, 'products', product.id), { imageUrl: deleteField(), thumbUrl: deleteField(), imagePaths: deleteField() });
}
