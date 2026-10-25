import { collection, query, where } from 'firebase/firestore';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { LOCATION_KINDS, UNITS } from '@shared/constants.js';
import { CAPS } from '@shared/roles.js';

import { DataTable } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/ui.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { physicalLocations, unitCostOf, useData, useQuery } from '../../lib/data.jsx';
import { db } from '../../lib/firebase.js';

/** Tabela e stokut për një ose disa vende magazinimi (përdoret edhe te automjetet dhe kantieret). */
export function StockTable({ locationIds, title, showLocation }) {
  const { productsById, locationsById, costsById } = useData();
  const { can } = useAuth();
  const navigate = useNavigate();
  const showCosts = can(CAPS.VIEW_COSTS);
  const key = locationIds?.join(',') || 'all';
  const stock = useQuery(() => {
    if (!locationIds) return query(collection(db, 'stock'));
    if (!locationIds.length) return null;
    return query(collection(db, 'stock'), where('locationId', 'in', locationIds.slice(0, 30)));
  }, [key]);

  const rows = stock.data
    .filter((s) => Math.abs(Number(s.qty || 0)) > 0.0005)
    .map((s) => ({ ...s, product: productsById[s.productId] || {}, location: locationsById[s.locationId] || {} }));

  return (
    <DataTable
      title={title}
      rows={rows}
      onRowClick={(r) => navigate(`/artikuj/${r.productId}`)}
      empty={stock.loading ? 'Duke ngarkuar…' : 'Nuk ka mall në këtë vend.'}
      columns={[
        { key: 'location', label: 'Vendi', hidden: !showLocation, value: (r) => r.location.name },
        { key: 'kind', label: 'Lloji', hidden: !showLocation, value: (r) => LOCATION_KINDS[r.locationKind] },
        { key: 'code', label: 'Kodi', value: (r) => r.product.code },
        { key: 'name', label: 'Artikulli', value: (r) => r.product.name },
        { key: 'category', label: 'Kategoria', value: (r) => r.product.categoryName },
        { key: 'unit', label: 'Njësia', value: (r) => UNITS[r.product.unit] || r.product.unit },
        { key: 'qty', label: 'Sasia', type: 'number', value: (r) => Number(r.qty), total: !showLocation || undefined },
        { key: 'cost', label: 'Kosto njësi', type: 'money', hidden: !showCosts, value: (r) => unitCostOf(costsById, r.productId) },
        { key: 'value', label: 'Vlera', type: 'money', total: true, hidden: !showCosts, value: (r) => Number(r.qty) * unitCostOf(costsById, r.productId) },
      ]}
    />
  );
}

export default function Stock() {
  const { locations } = useData();
  const [params, setParams] = useSearchParams();
  const selected = params.get('vendi') || 'main';
  const physical = physicalLocations(locations);
  const [kindFilter, setKindFilter] = useState('');

  const locationIds = useMemo(() => {
    if (selected === 'all') return kindFilter ? physical.filter((l) => l.kind === kindFilter).map((l) => l.id) : null;
    return [selected];
  }, [selected, kindFilter, physical]);

  const current = locations.find((l) => l.id === selected);

  return (
    <>
      <PageHeader title="Gjendja e stokut" subtitle="Sasitë fizike sipas magazinës, automjetit, kantierit ose shitësit." />
      <div className="row" style={{ marginBottom: 12 }}>
        <select value={selected} onChange={(e) => setParams({ vendi: e.target.value })} style={{ width: 'auto', minWidth: 240 }}>
          <option value="all">Të gjitha vendet</option>
          {Object.entries(LOCATION_KINDS).filter(([k]) => physical.some((l) => l.kind === k)).map(([k, label]) => (
            <optgroup key={k} label={label}>
              {physical.filter((l) => l.kind === k).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </optgroup>
          ))}
        </select>
        {selected === 'all' && (
          <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} style={{ width: 'auto' }}>
            <option value="">Çdo lloj vendi</option>
            {['main', 'vehicle', 'site', 'agent'].map((k) => <option key={k} value={k}>{LOCATION_KINDS[k]}</option>)}
          </select>
        )}
      </div>
      <StockTable
        locationIds={locationIds}
        title={`Gjendja e stokut · ${selected === 'all' ? 'të gjitha vendet' : current?.name || ''}`}
        showLocation={selected === 'all'}
      />
    </>
  );
}
