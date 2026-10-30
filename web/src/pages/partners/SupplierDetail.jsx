import { collection, deleteDoc, doc, query, where } from 'firebase/firestore';
import { useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';

import { MOVEMENT_STATUS, PO_STATUS } from '@shared/constants.js';

import { DataTable } from '../../components/DataTable.jsx';
import { EntityForm } from '../../components/EntityForm.jsx';
import { Card, Loading, PageHeader, StatusBadge, Tabs, useAction, useUi } from '../../components/ui.jsx';
import { useData, useQuery } from '../../lib/data.jsx';
import { call, db } from '../../lib/firebase.js';
import { date, money, todayISO } from '../../lib/format.js';
import { supplierFields } from './Suppliers.jsx';
import { ContactsList } from '../../components/Contacts.jsx';
import { productOption } from '../../components/ProductImage.jsx';
import { useRouteId } from '../../lib/prettyUrl.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { SupplierLedger } from '../finance/SupplierFinance.jsx';
import { CAPS } from '@shared/roles.js';

export default function SupplierDetail() {
  const id = useRouteId();
  const navigate = useNavigate();
  const { suppliersById, products, productsById } = useData();
  const { can } = useAuth();
  const [tab, setTab] = useState('prices');
  const [editing, setEditing] = useState(false);
  const [priceEdit, setPriceEdit] = useState(null);
  const [run, busy] = useAction();
  const { ask } = useUi();
  const supplier = suppliersById[id];
  const prices = useQuery(() => query(collection(db, 'supplierPrices'), where('supplierId', '==', id)), [id]);
  const orders = useQuery(() => query(collection(db, 'purchaseOrders'), where('supplierId', '==', id)), [id]);
  const receipts = useQuery(() => query(collection(db, 'movements'), where('supplierId', '==', id)), [id]);

  const removeSupplier = async () => {
    const ok = await ask({
      title: 'Fshi furnitorin',
      message: `Furnitori «${supplier.name}» do të fshihet përgjithmonë, bashkë me çmimet/ofertat e tij. Artikujt që e kanë furnitor kryesor mbeten pa furnitor.\n\nFurnitorët me fatura blerjeje, pagesa, porosi ose fletëhyrje nuk fshihen.`,
      confirmLabel: 'Fshi furnitorin', danger: true,
    });
    if (!ok) return;
    run(async () => {
      await call('deleteSupplier', { id });
      navigate('/furnitoret');
    }, 'Furnitori u fshi.');
  };

  if (!supplier) return <Loading />;
  const sortDate = (a, b) => (b.date || '').localeCompare(a.date || '');

  return (
    <>
      <PageHeader
        breadcrumb={<Link to="/furnitoret">Furnitorët</Link>}
        title={supplier.name}
        subtitle={[supplier.nipt && `NIPT ${supplier.nipt}`, supplier.contactPerson, supplier.phone, supplier.email].filter(Boolean).join(' · ')}
        actions={(
          <>
            <button type="button" className="btn" onClick={() => setEditing(true)}>Ndrysho</button>
            <Link className="btn primary" to={`/porosite?furnitori=${id}`}><Plus size={16} /> Porosi</Link>
            {can(CAPS.SUPPLIERS, CAPS.USERS) && <button type="button" className="btn danger" disabled={busy} onClick={removeSupplier}><Trash2 size={16} /> Fshi furnitorin</button>}
          </>
        )}
      />
      {supplier.notes && <div className="alert info">{supplier.notes}</div>}
      {(supplier.contacts || []).length > 0 && (
        <Card title="Kontaktet">
          <ContactsList primary={{ name: supplier.contactPerson, phone: supplier.phone, email: supplier.email }} contacts={supplier.contacts} />
        </Card>
      )}
      <Tabs active={tab} onChange={setTab} tabs={[
        { key: 'prices', label: `Çmimet / ofertat (${prices.data.length})` },
        { key: 'orders', label: `Porositë (${orders.data.length})` },
        { key: 'receipts', label: 'Historiku i blerjeve' },
        { key: 'products', label: 'Artikujt' },
        can(CAPS.FINANCE, CAPS.REPORTS) && { key: 'ledger', label: 'Kartela' },
      ]} />
      {tab === 'ledger' && <SupplierLedger supplierId={id} />}
      {tab === 'prices' && (
        <Card actions={<button type="button" className="btn small primary" onClick={() => setPriceEdit({ date: todayISO() })}><Plus size={16} /> Çmim / ofertë</button>}>
          <DataTable
            title={`Çmimet e ${supplier.name}`}
            rows={prices.data}
            onRowClick={setPriceEdit}
            columns={[
              { key: 'code', label: 'Kodi', value: (r) => productsById[r.productId]?.code },
              { key: 'name', label: 'Artikulli', value: (r) => productsById[r.productId]?.name },
              { key: 'price', label: 'Çmimi', type: 'money' },
              { key: 'leadDays', label: 'Afati (ditë)', type: 'number' },
              { key: 'date', label: 'Data', render: (r) => date(r.date) },
              { key: 'notes', label: 'Shënime' },
              {
                key: 'del', label: '', export: false, sortable: false,
                render: (r) => <button type="button" className="icon-btn" title="Fshi" onClick={(e) => { e.stopPropagation(); run(() => deleteDoc(doc(db, 'supplierPrices', r.id)), 'U fshi.'); }}><X size={16} /></button>,
              },
            ]}
          />
        </Card>
      )}
      {tab === 'orders' && (
        <DataTable
          title={`Porositë te ${supplier.name}`}
          rows={[...orders.data].sort(sortDate)}
          onRowClick={(o) => navigate(`/porosite/${o.id}`)}
          columns={[
            { key: 'date', label: 'Data', render: (o) => date(o.date) },
            { key: 'number', label: 'Nr.' },
            { key: 'expectedDate', label: 'Mbërritja', render: (o) => date(o.expectedDate) },
            { key: 'total', label: 'Vlera', type: 'money', total: true, value: (o) => (o.lines || []).reduce((s, l) => s + l.qty * (l.unitPrice || 0), 0) },
            { key: 'status', label: 'Statusi', value: (o) => PO_STATUS[o.status], render: (o) => <StatusBadge status={o.status} labels={PO_STATUS} /> },
          ]}
        />
      )}
      {tab === 'receipts' && (
        <DataTable
          title={`Blerjet nga ${supplier.name}`}
          rows={[...receipts.data].sort(sortDate)}
          onRowClick={(m) => navigate(`/levizjet/${m.id}`)}
          columns={[
            { key: 'date', label: 'Data', render: (m) => date(m.date) },
            { key: 'number', label: 'Nr.' },
            { key: 'fiscalRef', label: 'Nr. fature' },
            { key: 'lines', label: 'Artikuj', type: 'number', value: (m) => (m.lines || []).length },
            { key: 'status', label: 'Statusi', value: (m) => MOVEMENT_STATUS[m.status], render: (m) => <StatusBadge status={m.status} labels={MOVEMENT_STATUS} /> },
          ]}
        />
      )}
      {tab === 'products' && (
        <DataTable
          title={`Artikujt e ${supplier.name}`}
          rows={products.filter((p) => p.supplierId === id)}
          onRowClick={(p) => navigate(`/artikuj/${p.id}`)}
          columns={[
            { key: 'code', label: 'Kodi' },
            { key: 'name', label: 'Emri' },
            { key: 'qtyMain', label: 'Në magazinë', type: 'number' },
            { key: 'minStock', label: 'Stoku min.', type: 'number' },
          ]}
        />
      )}
      {editing && (
        <EntityForm title={`Ndrysho ${supplier.name}`} collectionName="suppliers" record={supplier} fields={supplierFields} onClose={() => setEditing(false)} />
      )}
      {priceEdit && (
        <EntityForm
          title={priceEdit.id ? 'Ndrysho çmimin' : 'Çmim / ofertë e re'}
          collectionName="supplierPrices"
          record={priceEdit.id ? priceEdit : null}
          defaults={priceEdit}
          onClose={() => setPriceEdit(null)}
          fields={[
            { key: 'productId', label: 'Artikulli', type: 'search', required: true, span: 2, options: products.map((p) => productOption(p)) },
            { key: 'price', label: 'Çmimi (L, pa TVSH)', type: 'number', required: true },
            { key: 'leadDays', label: 'Afati i dorëzimit (ditë)', type: 'number' },
            { key: 'date', label: 'Data e ofertës', type: 'date' },
            { key: 'notes', label: 'Shënime', span: 'all' },
          ]}
          transform={(d) => ({ ...d, supplierId: id })}
        />
      )}
    </>
  );
}
