import { doc, setDoc } from 'firebase/firestore';
import { useEffect, useState } from 'react';

import { Card, Field, PageHeader, useAction } from '../../components/ui.jsx';
import { useData } from '../../lib/data.jsx';
import { db } from '../../lib/firebase.js';
import { toNumber } from '../../lib/format.js';

const FIELDS = [
  ['name', 'Emri i kompanisë'],
  ['tagline', 'Përshkrimi i shkurtër'],
  ['nipt', 'NIPT'],
  ['address', 'Adresa'],
  ['phone', 'Telefoni'],
  ['email', 'Email'],
  ['web', 'Faqja web'],
];
const TEXTS = [
  ['defaultPaymentTerms', 'Kushtet standarde të pagesës (oferta)'],
  ['defaultDeliveryTerm', 'Afati standard i realizimit (oferta)'],
  ['offerFooter', 'Teksti në fund të ofertës'],
];

export default function Settings() {
  const { company } = useData();
  const [v, setV] = useState(null);
  const [run, busy] = useAction();
  useEffect(() => { if (company && !v) setV({ ...company }); }, [company, v]);
  if (!v) return null;
  const save = () => run(() => setDoc(doc(db, 'settings', 'company'), {
    ...Object.fromEntries([...FIELDS, ...TEXTS].map(([k]) => [k, v[k] || ''])),
    vatPct: toNumber(v.vatPct), offerValidityDays: toNumber(v.offerValidityDays),
  }, { merge: true }), 'Të dhënat u ruajtën.');

  return (
    <>
      <PageHeader title="Të dhënat e kompanisë" subtitle="Shfaqen në oferta, porosi dhe dokumentet PDF." actions={<button type="button" className="btn primary" disabled={busy} onClick={save}>Ruaj</button>} />
      <Card title="Identiteti">
        <div className="form-grid">
          {FIELDS.map(([k, l]) => <Field key={k} label={l}><input value={v[k] || ''} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></Field>)}
          <Field label="TVSH (%)"><input className="num" type="number" value={v.vatPct ?? 20} onChange={(e) => setV({ ...v, vatPct: e.target.value })} /></Field>
          <Field label="Vlefshmëria e ofertës (ditë)"><input className="num" type="number" value={v.offerValidityDays ?? 30} onChange={(e) => setV({ ...v, offerValidityDays: e.target.value })} /></Field>
          <Field label="Logoja" hint="Logoja SuperPool përdoret në menu, në faqen e hyrjes dhe në të gjitha PDF-të (fatura, oferta, fletë prodhimi, raporte).">
            <span className="logo-plate" style={{ height: 56, alignSelf: 'flex-start' }}><img src="/logo-superpool.jpg" alt="SuperPool" /></span>
          </Field>
        </div>
      </Card>
      <Card title="Tekstet standarde të ofertës">
        <div className="stack">
          {TEXTS.map(([k, l]) => <Field key={k} label={l}><textarea value={v[k] || ''} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></Field>)}
        </div>
      </Card>
    </>
  );
}
