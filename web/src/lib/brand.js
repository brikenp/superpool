// Logoja SuperPool për PDF-të. Përdoret siç është (sfondi blu i errët i saj vazhdon si shirit),
// pa e ngjyrosur apo prerë.

export const LOGO_URL = '/logo-superpool.jpg';
export const BRAND_NAVY = [25, 46, 65]; // ngjyra e sfondit të logos
export const BRAND_BLUE = [79, 179, 232]; // bluja e "POOL"
const LOGO_RATIO = 1080 / 267;

let logo = null;
let loading = null;

/** Ngarkon logon një herë si data URL (jsPDF ka nevojë për të në mënyrë sinkrone). */
export function loadLogo() {
  if (logo) return Promise.resolve(logo);
  loading ||= fetch(LOGO_URL)
    .then((r) => (r.ok ? r.blob() : null))
    .then((blob) => blob && new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(blob);
    }))
    .then((url) => { logo = url; return url; })
    .catch(() => null);
  return loading;
}

/**
 * Koka e çdo dokumenti PDF: shirit me ngjyrën e logos, logoja majtas, titulli djathtas,
 * të dhënat e kompanisë poshtë shiritit. Kthen y ku nis përmbajtja.
 */
export function brandHeader(doc, company = {}, title = '', subtitle = '') {
  const w = doc.internal.pageSize.getWidth();
  const band = 24;
  doc.setFillColor(...BRAND_NAVY);
  doc.rect(0, 0, w, band, 'F');
  const lh = 18;
  if (logo) {
    try { doc.addImage(logo, 'JPEG', 8, (band - lh) / 2, lh * LOGO_RATIO, lh); } catch { /* vazhdo pa logo */ }
  } else {
    doc.setFontSize(16);
    doc.setTextColor(255);
    doc.text('SUPERPOOL', 14, 15);
  }
  doc.setTextColor(255);
  doc.setFontSize(14);
  doc.text(title, w - 12, subtitle ? 11 : 14, { align: 'right' });
  if (subtitle) {
    doc.setFontSize(8.5);
    doc.setTextColor(...BRAND_BLUE);
    doc.text(subtitle, w - 12, 17, { align: 'right' });
  }
  const info = [
    company.name && company.name !== 'SuperPool' ? company.name : '',
    company.address,
    [company.phone, company.email, company.web].filter(Boolean).join(' · '),
    company.nipt ? `NIPT: ${company.nipt}` : '',
  ].filter(Boolean);
  doc.setFontSize(8);
  doc.setTextColor(90);
  if (info.length) doc.text(info.join('   |   '), 14, band + 5, { maxWidth: w - 28 });
  doc.setTextColor(20);
  return band + (info.length ? 11 : 6);
}

/** Fundi i çdo faqeje: logoja e vogël, teksti i kompanisë dhe numri i faqes. */
export function brandFooter(doc, text = '') {
  const pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i);
    const w = doc.internal.pageSize.getWidth();
    const h = doc.internal.pageSize.getHeight();
    const lh = 5.5;
    doc.setFillColor(...BRAND_NAVY);
    doc.rect(0, h - 9, w, 9, 'F');
    if (logo) {
      try { doc.addImage(logo, 'JPEG', 6, h - 9 + (9 - lh) / 2, lh * LOGO_RATIO, lh); } catch { /* pa logo */ }
    }
    doc.setFontSize(7.5);
    doc.setTextColor(220);
    if (text) doc.text(String(text).slice(0, 140), w / 2, h - 3.6, { align: 'center' });
    doc.text(`Faqe ${i} / ${pages}`, w - 10, h - 3.6, { align: 'right' });
  }
  doc.setTextColor(20);
}
