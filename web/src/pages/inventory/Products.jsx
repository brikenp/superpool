import { addDoc, collection, doc, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { UNITS } from '@shared/constants.js';
import { CAPS } from '@shared/roles.js';

import { DataTable } from '../../components/DataTable.jsx';
import { EntityForm, optionsFrom } from '../../components/EntityForm.jsx';
import { Badge, Field, Modal, PageHeader, SearchSelect, useAction } from '../../components/ui.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { unitCostOf, useData } from '../../lib/data.jsx';
import { db } from '../../lib/firebase.js';
import { round3, toNumber } from '../../lib/format.js';

export const freeQty = (p) => round3(Number(p.qtyMain || 0) - Number(p.qtyReserved || 0));

export function ProductForm({ product, onClose, onSaved }) {
  const { categories, categoriesById, suppliers, suppliersById, products, costsById } = useData();
  const { can } = useAuth();
  const showCosts = can(CAPS.VIEW_COSTS);
  const [v, setV] = useState(() => ({
    code: '', name: '', description: '', brand: '', model: '', unit: 'cope', categoryId: '', supplierId: '',
    salePrice: '', minStock: '', barcode: '', active: true,
    ...(product || {}),
    purchasePrice: product ? costsById[product.id]?.purchasePrice ?? '' : '',
  }));
  const [error, setError] = useState('');
  const [run, busy] = useAction();
  const set = (k, val) => setV((s) => ({ ...s, [k]: val }));

  const submit = (e) => {
    e.preventDefault();
    const code = v.code.trim();
    if (!code || !v.name.trim()) { setError('Kodi dhe emri janë të detyrueshëm.'); return; }
    const dup = products.find((p) => p.code?.toLowerCase() === code.toLowerCase() && p.id !== product?.id);
    if (dup) { setError(`Kodi ${code} përdoret nga "${dup.name}".`); return; }
    run(async () => {
      const category = categoriesById[v.categoryId];
      const supplier = suppliersById[v.supplierId];
      const data = {
        code,
        name: v.name.trim(),
        description: v.description || '',
        brand: v.brand || '',
        model: v.model || '',
        unit: v.unit,
        categoryId: v.categoryId || null,
        categoryName: category?.name || '',
        isChemical: Boolean(category?.isChemical),
        supplierId: v.supplierId || null,
        supplierName: supplier?.name || '',
        salePrice: toNumber(v.salePrice),
        minStock: toNumber(v.minStock),
        barcode: v.barcode || '',
        active: Boolean(v.active),
        updatedAt: serverTimestamp(),
      };
      let id = product?.id;
      if (id) {
        await setDoc(doc(db, 'products', id), data, { merge: true });
      } else {
        id = (await addDoc(collection(db, 'products'), { ...data, qtyTotal: 0, qtyMain: 0, qtyReserved: 0, createdAt: serverTimestamp() })).id;
      }
      if (showCosts && v.purchasePrice !== '' && Number(v.purchasePrice) !== Number(costsById[id]?.purchasePrice)) {
        const price = toNumber(v.purchasePrice);
        await setDoc(doc(db, 'productCosts', id), costsById[id] ? { purchasePrice: price } : { purchasePrice: price, avgCost: price }, { merge: true });
      }
      onSaved?.(id);
      onClose();
    }, 'Artikulli u ruajt.');
  };

  return (
    <Modal
      title={product ? `Ndrysho: ${product.code}` : 'Artikull i ri'}
      onClose={onClose}
      wide
      footer={(
        <>
          <button type="button" className="btn" onClick={onClose}>Anulo</button>
          <button type="submit" form="product-form" className="btn primary" disabled={busy}>Ruaj</button>
        </>
      )}
    >
      {error && <div className="alert error">{error}</div>}
      <form id="product-form" className="form-grid" onSubmit={submit}>
        <Field label="Kodi unik" required><input value={v.code} onChange={(e) => set('code', e.target.value)} /></Field>
        <Field label="Emri" required className="span-2"><input value={v.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Marka"><input value={v.brand} onChange={(e) => set('brand', e.target.value)} /></Field>
        <Field label="Modeli"><input value={v.model} onChange={(e) => set('model', e.target.value)} /></Field>
        <Field label="Njësia matëse">
          <select value={v.unit} onChange={(e) => set('unit', e.target.value)}>
            {Object.entries(UNITS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label="Kategoria">
          <select value={v.categoryId || ''} onChange={(e) => set('categoryId', e.target.value)}>
            <option value="">—</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}{c.isChemical ? ' (kimikate)' : ''}</option>)}
          </select>
        </Field>
        <Field label="Furnitori kryesor">
          <SearchSelect options={suppliers.map((s) => ({ value: s.id, label: s.name }))} value={v.supplierId || ''} onChange={(val) => set('supplierId', val)} />
        </Field>
        {showCosts && (
          <Field label="Çmimi i blerjes (L)" hint="Kosto mesatare përditësohet automatikisht nga fletëhyrjet.">
            <input className="num" type="number" step="any" value={v.purchasePrice} onChange={(e) => set('purchasePrice', e.target.value)} />
          </Field>
        )}
        <Field label="Çmimi i shitjes (L, me TVSH)"><input className="num" type="number" step="any" value={v.salePrice} onChange={(e) => set('salePrice', e.target.value)} /></Field>
        <Field label="Stoku minimal"><input className="num" type="number" step="any" value={v.minStock} onChange={(e) => set('minStock', e.target.value)} /></Field>
        <Field label="Barkodi"><input value={v.barcode} onChange={(e) => set('barcode', e.target.value)} /></Field>
        <Field label="Përshkrimi teknik" className="span-all"><textarea value={v.description} onChange={(e) => set('description', e.target.value)} /></Field>
        <Field className="span-all">
          <label className="checkbox"><input type="checkbox" checked={v.active} onChange={(e) => set('active', e.target.checked)} /> Aktiv</label>
        </Field>
      </form>
    </Modal>
  );
}

export default function Products() {
  const { products, categories, costsById } = useData();
  const { can } = useAuth();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(null);
  const [catModal, setCatModal] = useState(null);
  const [category, setCategory] = useState('');
  const [onlyLow, setOnlyLow] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const canManage = can(CAPS.INVENTORY_MANAGE);
  const showCosts = can(CAPS.VIEW_COSTS);

  const rows = useMemo(() => products.filter((p) => (showInactive || p.active !== false)
    && (!category || p.categoryId === category)
    && (!onlyLow || freeQty(p) < Number(p.minStock || 0))), [products, category, onlyLow, showInactive]);

  const columns = [
    { key: 'code', label: 'Kodi' },
    { key: 'name', label: 'Emri', render: (p) => <>{p.name}{p.active === false && <> <Badge>joaktiv</Badge></>}</> },
    { key: 'brand', label: 'Marka / modeli', value: (p) => [p.brand, p.model].filter(Boolean).join(' ') },
    { key: 'categoryName', label: 'Kategoria' },
    { key: 'unit', label: 'Njësia', value: (p) => UNITS[p.unit] || p.unit },
    { key: 'qtyTotal', label: 'Gjithsej', type: 'number', value: (p) => Number(p.qtyTotal || 0) },
    { key: 'qtyMain', label: 'Në magazinë', type: 'number', value: (p) => Number(p.qtyMain || 0) },
    { key: 'qtyReserved', label: 'Rezervuar', type: 'number', value: (p) => Number(p.qtyReserved || 0) },
    {
      key: 'free', label: 'E lirë', type: 'number', value: freeQty,
      render: (p) => <span className={freeQty(p) < Number(p.minStock || 0) ? 'text-danger bold' : ''}>{round3(freeQty(p)).toLocaleString('sq-AL')}</span>,
    },
    { key: 'cost', label: 'Kosto njësi', type: 'money', hidden: !showCosts, value: (p) => unitCostOf(costsById, p.id) },
    { key: 'value', label: 'Vlera e stokut', type: 'money', total: true, hidden: !showCosts, value: (p) => round3(Number(p.qtyTotal || 0) * unitCostOf(costsById, p.id)) },
  ];

  return (
    <>
      <PageHeader
        title="Artikujt"
        subtitle="Kartela e artikujve me sasinë fizike, të rezervuar dhe të lirë."
        actions={canManage && (
          <>
            <button type="button" className="btn" onClick={() => setCatModal({})}>Kategoritë</button>
            <button type="button" className="btn primary" onClick={() => setEditing({})}>+ Artikull i ri</button>
          </>
        )}
      />
      <DataTable
        title="Artikujt"
        columns={columns}
        rows={rows}
        onRowClick={(p) => navigate(`/artikuj/${p.id}`)}
        toolbar={(
          <>
            <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ width: 'auto' }}>
              <option value="">Të gjitha kategoritë</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <label className="checkbox"><input type="checkbox" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} /> Nën stokun minimal</label>
            <label className="checkbox"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Edhe joaktivët</label>
          </>
        )}
      />
      {editing && <ProductForm product={editing.id ? editing : null} onClose={() => setEditing(null)} />}
      {catModal && <Categories onClose={() => setCatModal(null)} />}
    </>
  );
}

function Categories({ onClose }) {
  const { categories, products } = useData();
  const [editing, setEditing] = useState(null);
  // Emri dhe flamuri "kimikate" ruhen edhe te artikujt, që filtrimi të jetë i shpejtë.
  const propagate = async (cat) => {
    const affected = products.filter((p) => p.categoryId === cat.id
      && (p.categoryName !== cat.name || Boolean(p.isChemical) !== Boolean(cat.isChemical)));
    for (let i = 0; i < affected.length; i += 400) {
      const batch = writeBatch(db);
      affected.slice(i, i + 400).forEach((p) => batch.update(doc(db, 'products', p.id), { categoryName: cat.name, isChemical: Boolean(cat.isChemical) }));
      await batch.commit();
    }
  };
  return (
    <Modal title="Kategoritë e artikujve" onClose={onClose}>
      <ul className="list-plain">
        {categories.map((c) => (
          <li key={c.id}>
            <span style={{ flex: 1 }}>{c.name}</span>
            {c.isChemical && <Badge tone="info">kimikate</Badge>}
            <button type="button" className="btn small" onClick={() => setEditing(c)}>Ndrysho</button>
          </li>
        ))}
      </ul>
      <button type="button" className="btn primary" onClick={() => setEditing({})}>+ Kategori e re</button>
      {editing && (
        <EntityForm
          title={editing.id ? 'Ndrysho kategorinë' : 'Kategori e re'}
          collectionName="categories"
          record={editing.id ? editing : null}
          onClose={() => setEditing(null)}
          onSaved={propagate}
          fields={[
            { key: 'name', label: 'Emri', required: true },
            { key: 'isChemical', label: 'Kimikate (shfaqen në modulin e shitjes së kimikateve)', type: 'checkbox' },
          ]}
        />
      )}
    </Modal>
  );
}

export const unitOptions = optionsFrom(UNITS);
