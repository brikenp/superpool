import { addDoc, collection, deleteDoc, doc, query, serverTimestamp, where } from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { useState } from 'react';
import { Paperclip, X, Plus } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { OFFER_STATUS, PAYMENT_METHODS, PROJECT_STATUS } from '@shared/constants.js';
import { CAPS } from '@shared/roles.js';

import { DataTable } from '../../components/DataTable.jsx';
import { PrintInvoiceButton, PrintPaymentButton, printColumn } from '../../components/PrintButton.jsx';
import { EntityForm } from '../../components/EntityForm.jsx';
import { Card, Field, Loading, PageHeader, Stat, StatusBadge, Tabs, useAction } from '../../components/ui.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { useData, useQuery } from '../../lib/data.jsx';
import { ContractsCard } from '../finance/Contracts.jsx';
import { db, storage } from '../../lib/firebase.js';
import { date, dateTime, money } from '../../lib/format.js';
import { InvoiceForm, PaymentForm, INVOICE_STATUS } from '../finance/Finance.jsx';
import { clientFields, normalizeClient } from './Clients.jsx';

export default function ClientCard() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { clientsById } = useData();
  const { uid, can } = useAuth();
  const [tab, setTab] = useState('overview');
  const [editing, setEditing] = useState(false);
  const [invoiceForm, setInvoiceForm] = useState(null);
  const [paymentForm, setPaymentForm] = useState(null);
  const client = clientsById[id];

  const seeOffers = can(CAPS.OFFERS);
  const seeProjects = can(CAPS.PROJECTS_VIEW);
  const seeAllSales = can(CAPS.CHEM_SALES_ALL, CAPS.REPORTS);
  const seeAllFinance = can(CAPS.REPORTS, CAPS.FINANCE);

  const offers = useQuery(() => (seeOffers ? query(collection(db, 'offers'), where('clientId', '==', id)) : null), [id, seeOffers]);
  const projects = useQuery(() => (seeProjects ? query(collection(db, 'projects'), where('clientId', '==', id)) : null), [id, seeProjects]);
  const sales = useQuery(() => (seeAllSales
    ? query(collection(db, 'sales'), where('clientId', '==', id))
    : query(collection(db, 'sales'), where('clientId', '==', id), where('sellerUid', '==', uid))), [id, seeAllSales, uid]);
  const invoices = useQuery(() => (seeAllFinance
    ? query(collection(db, 'invoices'), where('clientId', '==', id))
    : query(collection(db, 'invoices'), where('clientId', '==', id), where('createdBy', '==', uid))), [id, seeAllFinance, uid]);
  const payments = useQuery(() => (seeAllFinance
    ? query(collection(db, 'payments'), where('clientId', '==', id))
    : query(collection(db, 'payments'), where('clientId', '==', id), where('createdBy', '==', uid))), [id, seeAllFinance, uid]);

  if (!client) return <Loading />;

  const activeInvoices = invoices.data.filter((i) => i.status !== 'cancelled');
  const activePayments = payments.data.filter((p) => p.status !== 'cancelled');
  const invoiced = activeInvoices.reduce((s, i) => s + Number(i.amount || 0), 0);
  const paid = activePayments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const today = new Date().toISOString().slice(0, 10);
  const overdue = activeInvoices.filter((i) => i.dueDate && i.dueDate < today).reduce((s, i) => s + Number(i.amount || 0), 0) - paid;
  const byDate = (a, b) => (b.date || '').localeCompare(a.date || '');

  return (
    <>
      <PageHeader
        breadcrumb={<Link to="/klientet">Klientët</Link>}
        title={client.name}
        subtitle={[client.nipt && `NIPT ${client.nipt}`, client.contactPerson, client.phone, client.email, client.city].filter(Boolean).join(' · ')}
        actions={(
          <>
            {can(CAPS.CLIENTS_MANAGE, CAPS.FINANCE) && <button type="button" className="btn" onClick={() => setEditing(true)}>Ndrysho</button>}
            {seeOffers && <Link className="btn" to={`/ofertat/re?klienti=${id}`}><Plus size={16} /> Ofertë</Link>}
            {can(CAPS.CHEM_SALES) && <Link className="btn primary" to={`/kimikate/shitje-e-re?klienti=${id}`}><Plus size={16} /> Shitje</Link>}
          </>
        )}
      />
      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Stat label="Faturuar gjithsej" value={money(invoiced)} />
        <Stat label="Paguar" value={money(paid)} tone="ok" />
        <Stat label="Detyrimi i papaguar" value={money(invoiced - paid)} tone={invoiced - paid > 0.01 ? 'danger' : 'ok'} sub={overdue > 0.01 ? `Me afat të kaluar: ${money(overdue)}` : undefined} />
        <Stat label="Projekte / shitje" value={`${projects.data.length} / ${sales.data.filter((s) => s.status === 'confirmed').length}`} />
      </div>
      <Tabs active={tab} onChange={setTab} tabs={[
        { key: 'overview', label: 'Të dhënat' },
        seeOffers && { key: 'offers', label: `Ofertat (${offers.data.length})` },
        seeProjects && { key: 'projects', label: `Projektet (${projects.data.length})` },
        { key: 'sales', label: `Shitjet (${sales.data.length})` },
        { key: 'finance', label: 'Faturat & pagesat' },
        { key: 'docs', label: 'Dokumente & shënime' },
      ]} />
      {tab === 'overview' && (
        <Card>
          <dl className="props">
            <dt>Lloji</dt><dd>{client.type === 'business' ? 'Biznes' : 'Individ'}</dd>
            <dt>Adresa</dt><dd>{[client.address, client.city].filter(Boolean).join(', ') || '—'}</dd>
            <dt>ID në faturim</dt><dd>{client.billingId || '—'}</dd>
          </dl>
          {client.notes && <p style={{ whiteSpace: 'pre-line' }}>{client.notes}</p>}
        </Card>
      )}
      {tab === 'offers' && (
        <DataTable
          title={`Ofertat · ${client.name}`}
          rows={[...offers.data].sort(byDate)}
          onRowClick={(o) => navigate(`/ofertat/${o.id}`)}
          columns={[
            { key: 'date', label: 'Data', render: (o) => date(o.date) },
            { key: 'number', label: 'Nr.' },
            { key: 'projectName', label: 'Projekti' },
            { key: 'total', label: 'Vlera me TVSH', type: 'money', value: (o) => o.totals?.total || 0 },
            { key: 'status', label: 'Statusi', value: (o) => OFFER_STATUS[o.status], render: (o) => <StatusBadge status={o.status} labels={OFFER_STATUS} /> },
          ]}
        />
      )}
      {tab === 'projects' && (
        <DataTable
          title={`Projektet · ${client.name}`}
          rows={projects.data}
          onRowClick={(p) => navigate(`/projektet/${p.id}`)}
          columns={[
            { key: 'code', label: 'Kodi' },
            { key: 'name', label: 'Emri' },
            { key: 'address', label: 'Vendndodhja' },
            { key: 'startDate', label: 'Fillimi', render: (p) => date(p.startDate) },
            { key: 'status', label: 'Statusi', value: (p) => PROJECT_STATUS[p.status], render: (p) => <StatusBadge status={p.status} labels={PROJECT_STATUS} /> },
          ]}
        />
      )}
      {tab === 'sales' && (
        <DataTable
          title={`Shitjet · ${client.name}`}
          rows={[...sales.data].sort(byDate)}
          onRowClick={(s) => navigate(`/kimikate/${s.id}`)}
          columns={[
            { key: 'date', label: 'Data', render: (s) => date(s.date) },
            { key: 'number', label: 'Nr.' },
            { key: 'products', label: 'Produktet', value: (s) => (s.lines || []).map((l) => `${l.name} ×${l.qty}`).join(', ') },
            { key: 'paymentMethod', label: 'Pagesa', value: (s) => PAYMENT_METHODS[s.paymentMethod] },
            { key: 'total', label: 'Vlera', type: 'money', total: true, value: (s) => (s.status === 'cancelled' ? 0 : s.total) },
            { key: 'status', label: 'Statusi', render: (s) => (s.status === 'cancelled' ? <StatusBadge status="cancelled" labels={{ cancelled: 'Anuluar' }} /> : '') },
          ]}
        />
      )}
      {tab === 'finance' && can(CAPS.FINANCE, CAPS.PROJECTS_MANAGE, CAPS.REPORTS) && <ContractsCard clientId={id} />}
      {tab === 'finance' && (
        <div className="grid grid-2">
          <Card title="Faturat" actions={can(CAPS.FINANCE) && <button type="button" className="btn small" onClick={() => setInvoiceForm({ clientId: id })}><Plus size={16} /> Faturë</button>}>
            <DataTable
              search={false}
              title={`Faturat · ${client.name}`}
              rows={[...invoices.data].sort(byDate)}
              onRowClick={can(CAPS.FINANCE) ? setInvoiceForm : undefined}
              columns={[
                { key: 'date', label: 'Data', render: (i) => date(i.date) },
                { key: 'number', label: 'Nr. fiskal', value: (i) => i.fiscalNumber || i.internalNumber },
                { key: 'dueDate', label: 'Afati', render: (i) => date(i.dueDate) },
                { key: 'amount', label: 'Vlera', type: 'money', total: true, value: (i) => (i.status === 'cancelled' ? 0 : i.amount) },
                { key: 'status', label: 'Statusi', value: (i) => INVOICE_STATUS[i.status], render: (i) => <StatusBadge status={i.status} labels={INVOICE_STATUS} /> },
                printColumn((i) => <PrintInvoiceButton invoice={i} />),
              ]}
            />
          </Card>
          <Card title="Pagesat" actions={can(CAPS.FINANCE) && <button type="button" className="btn small" onClick={() => setPaymentForm({ clientId: id })}><Plus size={16} /> Pagesë</button>}>
            <DataTable
              search={false}
              title={`Pagesat · ${client.name}`}
              rows={[...payments.data].sort(byDate)}
              columns={[
                { key: 'date', label: 'Data', render: (p) => date(p.date) },
                { key: 'method', label: 'Mënyra', value: (p) => PAYMENT_METHODS[p.method] || p.method },
                { key: 'reference', label: 'Referenca' },
                { key: 'amount', label: 'Shuma', type: 'money', total: true, value: (p) => (p.status === 'cancelled' ? 0 : p.amount) },
                printColumn((p) => <PrintPaymentButton payment={p} />),
              ]}
            />
          </Card>
        </div>
      )}
      {tab === 'docs' && <ClientDocuments clientId={id} />}
      {editing && <EntityForm title={`Ndrysho ${client.name}`} collectionName="clients" record={client} fields={clientFields} transform={normalizeClient} onClose={() => setEditing(false)} />}
      {invoiceForm && <InvoiceForm record={invoiceForm} onClose={() => setInvoiceForm(null)} />}
      {paymentForm && <PaymentForm record={paymentForm} invoices={activeInvoices} onClose={() => setPaymentForm(null)} />}
    </>
  );
}

function ClientDocuments({ clientId }) {
  const { uid, profile, can } = useAuth();
  const docs = useQuery(() => query(collection(db, 'clients', clientId, 'documents')), [clientId]);
  const [note, setNote] = useState('');
  const [run, busy] = useAction();
  const canWrite = can(CAPS.CLIENTS_MANAGE, CAPS.FINANCE, CAPS.OFFERS);

  const addNote = () => run(async () => {
    await addDoc(collection(db, 'clients', clientId, 'documents'), { type: 'note', text: note, uploadedBy: uid, uploadedByName: profile?.name, at: serverTimestamp() });
    setNote('');
  }, 'Shënimi u ruajt.');
  const upload = (file) => run(async () => {
    const path = `clients/${clientId}/${Date.now()}_${file.name}`;
    await uploadBytes(storageRef(storage, path), file);
    const url = await getDownloadURL(storageRef(storage, path));
    await addDoc(collection(db, 'clients', clientId, 'documents'), { type: 'file', title: file.name, path, url, size: file.size, uploadedBy: uid, uploadedByName: profile?.name, at: serverTimestamp() });
  }, 'Dokumenti u ngarkua.');
  const remove = (d) => run(async () => {
    if (d.path) await deleteObject(storageRef(storage, d.path)).catch(() => {});
    await deleteDoc(doc(db, 'clients', clientId, 'documents', d.id));
  }, 'U fshi.');

  const list = [...docs.data].sort((a, b) => (b.at?.seconds || 0) - (a.at?.seconds || 0));
  return (
    <Card>
      {canWrite && (
        <div className="grid grid-2" style={{ marginBottom: 12 }}>
          <Field label="Shënim i ri">
            <textarea value={note} onChange={(e) => setNote(e.target.value)} />
            <button type="button" className="btn small" style={{ marginTop: 6, alignSelf: 'flex-start' }} disabled={!note.trim() || busy} onClick={addNote}>Ruaj shënimin</button>
          </Field>
          <Field label="Ngarko dokument (kontratë, foto, PDF…)">
            <input type="file" disabled={busy} onChange={(e) => e.target.files[0] && upload(e.target.files[0])} />
          </Field>
        </div>
      )}
      <ul className="list-plain">
        {list.map((d) => (
          <li key={d.id}>
            <span style={{ flex: 1, whiteSpace: 'pre-line' }}>
              {d.type === 'file' ? <a href={d.url} target="_blank" rel="noreferrer"><Paperclip size={14} /> {d.title}</a> : d.text}
              <br /><small className="muted">{d.uploadedByName} · {dateTime(d.at)}</small>
            </span>
            {can(CAPS.CLIENTS_MANAGE) && <button type="button" className="icon-btn" onClick={() => remove(d)}><X size={16} /></button>}
          </li>
        ))}
        {!list.length && <li className="muted">Nuk ka dokumente ose shënime.</li>}
      </ul>
    </Card>
  );
}
