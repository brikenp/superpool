import { addDoc, collection, doc, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore';
import { Camera, FlaskConical, Plus, Trash2 } from 'lucide-react';
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
import { removeProductImage, uploadProductImage } from '../../lib/images.js';
import { ProductThumb } from '../../components/ProductImage.jsx';
import { money, round3, toNumber } from '../../lib/format.js';
import { priceFields } from '@shared/prices.js';

export const freeQty = (p) => round3(Number(p.qtyMain || 0) - Number(p.qtyReserved || 0));

/** Çmim me zgjedhje monedhe (L / €). */
function PriceInput({ value, currency, onValue, onCurrency }) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <input className="num" type="number" step="any" value={value} onChange={(e) => onValue(e.target.value)} style={{ flex: 1, minWidth: 0 }} />
      <select value={currency} onChange={(e) => onCurrency(e.target.value)} style={{ width: 'auto' }} aria-label="Monedha">
        <option value="ALL">L</option>
        <option value="EUR">€</option>
      </select>
    </div>
  );
}

export function ProductForm({ product, onClose, onSaved }) {
  const { categories, categoriesById, suppliers, suppliersById, products, costsById, company } = useData();
  const { can } = useAuth();
  const showCosts = can(CAPS.VIEW_COSTS);
  const [v, setV] = useState(() => ({
    code: '', name: '', description: '', brand: '', model: '', unit: 'cope', categoryId: '', supplierId: '',
    salePrice: '', minStock: '', barcode: '', active: true,
    ...(product || {}),
    // Çmimet shfaqen në monedhën ku janë vendosur (lekë ose euro).
    saleCurrency: product?.salePriceCurrency === 'EUR' ? 'EUR' : 'ALL',
    ...(product?.salePriceCurrency === 'EUR' ? { salePrice: product.salePriceEur ?? '' } : {}),
    purchaseCurrency: product && costsById[product.id]?.purchaseCurrency === 'EUR' ? 'EUR' : 'ALL',
    purchasePrice: product
      ? (costsById[product.id]?.purchaseCurrency === 'EUR' ? costsById[product.id]?.purchasePriceEur : costsById[product.id]?.purchasePrice) ?? ''
      : '',
  }));
  const [recipe, setRecipe] = useState(() => (product?.recipe || []).map((c) => ({ ...c })));
  const [composite, setComposite] = useState(() => recipe.length > 0);
  const materialOptions = useMemo(() => products
    .filter((p) => p.id !== product?.id && !p.recipe?.length && p.active !== false)
    .map((p) => ({ value: p.id, label: `${p.code} · ${p.name}`, sub: UNITS[p.unit] || p.unit })), [products, product]);
  const setPart = (i, patch) => setRecipe((r) => r.map((c, k) => (k === i ? { ...c, ...patch } : c)));
  const [error, setError] = useState('');
  const [photo, setPhoto] = useState(null); // File e re, ose 'remove'
  const photoPreview = useMemo(() => (photo && photo !== 'remove' ? URL.createObjectURL(photo) : null), [photo]);
  const currentPhoto = photo === 'remove' ? null : photoPreview || product?.imageUrl;
  const [run, busy] = useAction();
  const set = (k, val) => setV((s) => ({ ...s, [k]: val }));

  const submit = (e) => {
    e.preventDefault();
    const code = v.code.trim();
    if (!code || !v.name.trim()) { setError('Kodi dhe emri janë të detyrueshëm.'); return; }
    const dup = products.find((p) => p.code?.toLowerCase() === code.toLowerCase() && p.id !== product?.id);
    if (dup) { setError(`Kodi ${code} përdoret nga "${dup.name}".`); return; }
    const parts = composite ? recipe.filter((c) => c.productId).map((c) => ({ productId: c.productId, qty: round3(toNumber(c.qty)) })) : [];
    if (composite && !parts.length) { setError('Shtoni materialet e recetës ose hiqni zgjedhjen «Artikull i përbërë».'); return; }
    if (parts.some((c) => !(c.qty > 0))) { setError('Sasia e çdo materiali në recetë duhet të jetë më e madhe se zero.'); return; }
    if (new Set(parts.map((c) => c.productId)).size !== parts.length) { setError('Një material është shtuar dy herë në recetë.'); return; }
    const rate = toNumber(company.eurRate);
    const usesEur = (v.saleCurrency === 'EUR' && v.salePrice !== '') || (showCosts && v.purchaseCurrency === 'EUR' && v.purchasePrice !== '');
    if (usesEur && !(rate > 1)) { setError('Për çmimet në euro vendosni kursin e euros te Cilësimet.'); return; }
    const sale = priceFields(toNumber(v.salePrice), v.saleCurrency, rate);
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
        salePrice: sale.all,
        salePriceCurrency: v.saleCurrency,
        salePriceEur: sale.eur,
        minStock: toNumber(v.minStock),
        barcode: v.barcode || '',
        active: Boolean(v.active),
        recipe: parts.map((c) => ({ ...c, code: products.find((p) => p.id === c.productId)?.code || '', name: products.find((p) => p.id === c.productId)?.name || '' })),
        updatedAt: serverTimestamp(),
      };
      let id = product?.id;
      if (id) {
        await setDoc(doc(db, 'products', id), data, { merge: true });
      } else {
        id = (await addDoc(collection(db, 'products'), { ...data, qtyTotal: 0, qtyMain: 0, qtyReserved: 0, createdAt: serverTimestamp() })).id;
      }
      const oldCost = costsById[id];
      const oldPurchase = oldCost?.purchaseCurrency === 'EUR' ? oldCost.purchasePriceEur : oldCost?.purchasePrice;
      const oldPurchaseCur = oldCost?.purchaseCurrency === 'EUR' ? 'EUR' : 'ALL';
      if (showCosts && v.purchasePrice !== '' && (Number(v.purchasePrice) !== Number(oldPurchase) || v.purchaseCurrency !== oldPurchaseCur)) {
        const f = priceFields(toNumber(v.purchasePrice), v.purchaseCurrency, rate);
        const costs = { purchasePrice: f.all, purchaseCurrency: v.purchaseCurrency, purchasePriceEur: f.eur };
        await setDoc(doc(db, 'productCosts', id), oldCost ? costs : { ...costs, avgCost: f.all }, { merge: true });
      }
      if (photo === 'remove' && product) await removeProductImage(product);
      else if (photo) {
        if (product?.imagePaths) await removeProductImage(product);
        await uploadProductImage(id, photo);
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
        <Field label="Fotoja" className="span-all" hint="Nga telefoni mund të bëni foto direkt me kamerën.">
          <div className="photo-box">
            {currentPhoto ? <img className="preview" src={currentPhoto} alt="" /> : <div className="preview placeholder"><Camera size={36} /></div>}
            <div className="stack">
              <label className="btn">
                {currentPhoto ? 'Ndrysho foton' : 'Shto foto'}
                <input type="file" accept="image/*" hidden onChange={(e) => e.target.files[0] && setPhoto(e.target.files[0])} />
              </label>
              {currentPhoto && <button type="button" className="btn danger" onClick={() => setPhoto(product?.imageUrl ? 'remove' : null)}>Hiq foton</button>}
            </div>
          </div>
        </Field>
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
          <Field label="Çmimi i blerjes (pa TVSH)" hint={v.purchaseCurrency === 'EUR' && company.eurRate ? `≈ ${money(toNumber(v.purchasePrice) * company.eurRate)} me kursin ${company.eurRate}` : 'Kosto mesatare përditësohet automatikisht nga fletëhyrjet.'}>
            <PriceInput value={v.purchasePrice} currency={v.purchaseCurrency} onValue={(x) => set('purchasePrice', x)} onCurrency={(c) => set('purchaseCurrency', c)} />
          </Field>
        )}
        <Field label="Çmimi i shitjes (me TVSH)" hint={v.saleCurrency === 'EUR' && company.eurRate ? `≈ ${money(toNumber(v.salePrice) * company.eurRate)} me kursin ${company.eurRate}` : undefined}>
          <PriceInput value={v.salePrice} currency={v.saleCurrency} onValue={(x) => set('salePrice', x)} onCurrency={(c) => set('saleCurrency', c)} />
        </Field>
        <Field label="Stoku minimal"><input className="num" type="number" step="any" value={v.minStock} onChange={(e) => set('minStock', e.target.value)} /></Field>
        <Field label="Barkodi"><input value={v.barcode} onChange={(e) => set('barcode', e.target.value)} /></Field>
        <Field label="Përshkrimi teknik" className="span-all"><textarea value={v.description} onChange={(e) => set('description', e.target.value)} /></Field>
        <Field className="span-all">
          <label className="checkbox"><input type="checkbox" checked={v.active} onChange={(e) => set('active', e.target.checked)} /> Aktiv</label>
        </Field>
        <div className="span-all card" style={{ marginBottom: 0, padding: 14 }}>
          <label className="checkbox" style={{ fontWeight: 600 }}>
            <input type="checkbox" checked={composite} onChange={(e) => { setComposite(e.target.checked); if (e.target.checked && !recipe.length) setRecipe([{ productId: '', qty: '' }]); }} />
            <FlaskConical size={16} /> Artikull i përbërë — prodhohet nga materiale (receta)
          </label>
          {composite && (
            <>
              <p className="muted" style={{ margin: '8px 0', fontSize: '0.85rem' }}>
                Sasia e çdo materiali për 1 {UNITS[v.unit] || v.unit} {v.name || 'artikull'}. Prodhimi regjistrohet me «Fletë prodhimi» (materialet dalin, artikulli hyn në stok). Kur shitet më shumë sesa ka gjendje, sasia që mungon prodhohet automatikisht me fletë prodhimi të lidhur me faturën.
              </p>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Materiali</th><th className="r" style={{ width: 150 }}>Sasia për 1 {UNITS[v.unit] || v.unit}</th><th style={{ width: 40 }} /></tr></thead>
                  <tbody>
                    {recipe.map((c, i) => (
                      <tr key={i}>
                        <td><SearchSelect options={materialOptions} value={c.productId} onChange={(val) => setPart(i, { productId: val })} /></td>
                        <td><input className="num" type="number" step="any" min="0" value={c.qty} onChange={(e) => setPart(i, { qty: e.target.value })} /></td>
                        <td><button type="button" className="btn ghost small" aria-label="Hiq" onClick={() => setRecipe((r) => r.filter((_, k) => k !== i))}><Trash2 size={16} /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button type="button" className="btn small" style={{ marginTop: 8 }} onClick={() => setRecipe((r) => [...r, { productId: '', qty: '' }])}><Plus size={14} /> Material</button>
              {showCosts && recipe.some((c) => c.productId) && (
                <span className="muted" style={{ marginLeft: 12, fontSize: '0.85rem' }}>
                  Kosto e materialeve për 1 {UNITS[v.unit] || v.unit}: {recipe.reduce((sum, c) => sum + toNumber(c.qty) * unitCostOf(costsById, c.productId), 0).toFixed(2)} L
                </span>
              )}
            </>
          )}
        </div>
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
    { key: 'photo', label: '', sortable: false, export: false, render: (p) => <ProductThumb product={p} size={42} /> },
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
            <button type="button" className="btn primary" onClick={() => setEditing({})}><Plus size={16} /> Artikull i ri</button>
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
      <button type="button" className="btn primary" onClick={() => setEditing({})}><Plus size={16} /> Kategori e re</button>
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
