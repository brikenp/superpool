import { Package } from 'lucide-react';
import { useState } from 'react';

import { Modal } from './ui.jsx';

/** Miniatura e artikullit; me klik hapet fotoja e madhe. */
export function ProductThumb({ product, size = 40, zoom = true }) {
  const [open, setOpen] = useState(false);
  const src = product?.thumbUrl || product?.imageUrl;
  if (!src) return <span className="thumb empty" style={{ width: size, height: size }} aria-hidden="true"><Package size={Math.round(size * 0.45)} /></span>;
  return (
    <>
      <img
        className="thumb"
        src={src}
        alt={product.name || ''}
        loading="lazy"
        style={{ width: size, height: size }}
        onClick={zoom ? (e) => { e.stopPropagation(); setOpen(true); } : undefined}
      />
      {open && <ImageModal product={product} onClose={() => setOpen(false)} />}
    </>
  );
}

export function ImageModal({ product, onClose }) {
  return (
    <Modal title={`${product.code || ''} · ${product.name || ''}`} onClose={onClose} wide>
      <img src={product.imageUrl || product.thumbUrl} alt={product.name || ''} style={{ width: '100%', maxHeight: '75vh', objectFit: 'contain' }} />
    </Modal>
  );
}

/** Opsion për SearchSelect me miniaturën e artikullit. */
export const productOption = (p, sub) => ({
  value: p.id,
  label: `${p.code} · ${p.name}`,
  sub: sub ?? [p.brand, p.model].filter(Boolean).join(' · '),
  search: p.barcode,
  image: p.thumbUrl || p.imageUrl || '',
});
