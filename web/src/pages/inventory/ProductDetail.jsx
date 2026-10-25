import { collection, query, where } from 'firebase/firestore';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { LOCATION_KINDS, MOVEMENT_KINDS, MOVEMENT_STATUS, UNITS } from '@shared/constants.js';
import { CAPS } from '@shared/roles.js';

import { DataTable } from '../../components/DataTable.jsx';
import { Card, Empty, Loading, PageHeader, Stat, StatusBadge } from '../../components/ui.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { useDocument, useQuery, useData, unitCostOf } from '../../lib/data.jsx';
import { db } from '../../lib/firebase.js';
import { date, money, qty } from '../../lib/format.js';
import { ProductForm, freeQty } from './Products.jsx';
import { ImageModal } from '../../components/ProductImage.jsx';

export default function ProductDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { productsById, locationsById, costsById, suppliersById } = useData();
  const { can } = useAuth();
  const [editing, setEditing] = useState(false);
  const product = productsById[id];
  const showCosts = can(CAPS.VIEW_COSTS);

  const stock = useQuery(() => query(collection(db, 'stock'), where('productId', '==', id)), [id]);
  const movements = useQuery(() => query(collection(db, 'movements'), where('productIds', 'array-contains', id)), [id]);
  const prices = useQuery(() => (showCosts ? query(collection(db, 'supplierPrices'), where('productId', '==', id)) : null), [id, showCosts]);
  const fiscal = useDocument(showCosts ? `fiscalStock/${id}` : null);

  if (!product) return <Loading />;
  const cost = costsById[id] || {};
  const unit = UNITS[product.unit] || product.unit;
  const stockRows = stock.data.filter((s) => Number(s.qty) !== 0).map((s) => ({ ...s, location: locationsById[s.locationId] }));

  const history = movements.data
    .map((m) => {
      const q = (m.lines || []).filter((l) => l.productId === id).reduce((s, l) => s + Number(l.qty || 0), 0);
      return { ...m, q };
    })
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || String(b.number).localeCompare(String(a.number)));

  return (
    <>
      <PageHeader
        breadcrumb={<Link to="/artikuj">Artikujt</Link>}
        title={`${product.code} · ${product.name}`}
        subtitle={[product.brand, product.model, product.categoryName].filter(Boolean).join(' · ')}
        actions={can(CAPS.INVENTORY_MANAGE) && <button type="button" className="btn" onClick={() => setEditing(true)}>Ndrysho</button>}
      />
      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Stat label="Sasia fizike gjithsej" value={`${qty(product.qtyTotal)} ${unit}`} />
        <Stat label="Në magazinë kryesore" value={`${qty(product.qtyMain)} ${unit}`} />
        <Stat label="E rezervuar për projekte" value={`${qty(product.qtyReserved)} ${unit}`} />
        <Stat label="E lirë" value={`${qty(freeQty(product))} ${unit}`} tone={freeQty(product) < Number(product.minStock || 0) ? 'danger' : 'ok'}
          sub={product.minStock ? `Stoku minimal: ${qty(product.minStock)}` : undefined} />
      </div>
      <div className="grid grid-2">
        <Card title="Të dhënat">
          {product.imageUrl && <ProductHero product={product} />}
          <dl className="props">
            <dt>Njësia</dt><dd>{unit}</dd>
            <dt>Furnitori</dt><dd>{product.supplierId ? <Link to={`/furnitoret/${product.supplierId}`}>{product.supplierName}</Link> : '—'}</dd>
            <dt>Çmimi i shitjes</dt><dd>{money(product.salePrice)}</dd>
            {showCosts && (
              <>
                <dt>Çmimi i fundit i blerjes</dt><dd>{money(cost.purchasePrice)} {cost.lastPurchaseDate && <small>({date(cost.lastPurchaseDate)}{cost.lastSupplierId ? `, ${suppliersById[cost.lastSupplierId]?.name || ''}` : ''})</small>}</dd>
                <dt>Kosto mesatare</dt><dd>{money(unitCostOf(costsById, id))}</dd>
                <dt>Vlera e stokut</dt><dd>{money(Number(product.qtyTotal || 0) * unitCostOf(costsById, id))}</dd>
                <dt>Gjendja fiskale</dt><dd>{fiscal.data ? `${qty(fiscal.data.quantity)} ${unit} (më ${date(fiscal.data.asOf)})` : '—'}</dd>
              </>
            )}
            {product.barcode && <><dt>Barkodi</dt><dd>{product.barcode}</dd></>}
          </dl>
          {product.description && <p style={{ whiteSpace: 'pre-line' }}>{product.description}</p>}
        </Card>
        <Card title="Ku ndodhet malli">
          {stock.loading ? <Loading /> : stockRows.length ? (
            <ul className="list-plain">
              {stockRows.map((s) => (
                <li key={s.id}>
                  <Link to={`/vendet/${s.locationId}`} style={{ flex: 1 }}>{s.location?.name || s.locationId}</Link>
                  <small className="muted">{LOCATION_KINDS[s.locationKind]}</small>
                  <b>{qty(s.qty)} {unit}</b>
                </li>
              ))}
            </ul>
          ) : <Empty>Nuk ka gjendje.</Empty>}
        </Card>
      </div>
      {showCosts && prices.data.length > 0 && (
        <Card title="Çmimet e furnitorëve">
          <DataTable
            search={false}
            title={`Çmimet ${product.code}`}
            rows={prices.data}
            columns={[
              { key: 'supplier', label: 'Furnitori', value: (r) => suppliersById[r.supplierId]?.name || '' },
              { key: 'price', label: 'Çmimi', type: 'money' },
              { key: 'leadDays', label: 'Afati (ditë)', type: 'number' },
              { key: 'date', label: 'Data', render: (r) => date(r.date) },
              { key: 'notes', label: 'Shënime' },
            ]}
            initialSort={{ key: 'price', dir: 'asc' }}
          />
        </Card>
      )}
      <Card title="Historiku i hyrjeve dhe daljeve">
        <DataTable
          title={`Historiku ${product.code}`}
          rows={history}
          onRowClick={(m) => navigate(`/levizjet/${m.id}`)}
          columns={[
            { key: 'date', label: 'Data', render: (m) => date(m.date) },
            { key: 'number', label: 'Nr.' },
            { key: 'kind', label: 'Lloji', value: (m) => MOVEMENT_KINDS[m.kind]?.label },
            { key: 'from', label: 'Nga', value: (m) => m.sourceName },
            { key: 'to', label: 'Drejt', value: (m) => m.destName },
            { key: 'q', label: 'Sasia', type: 'number' },
            { key: 'status', label: 'Statusi', value: (m) => MOVEMENT_STATUS[m.status], render: (m) => <StatusBadge status={m.status} labels={MOVEMENT_STATUS} /> },
          ]}
        />
      </Card>
      {editing && <ProductForm product={product} onClose={() => setEditing(false)} />}
    </>
  );
}

function ProductHero({ product }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <img className="product-hero" src={product.imageUrl} alt={product.name} onClick={() => setOpen(true)} style={{ marginBottom: 12 }} />
      {open && <ImageModal product={product} onClose={() => setOpen(false)} />}
    </>
  );
}
