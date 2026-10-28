import { collection, query, where } from 'firebase/firestore';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { MOVEMENT_KINDS } from '@shared/constants.js';

import { DataTable } from '../../components/DataTable.jsx';
import { Card, Field, PageHeader, Tabs } from '../../components/ui.jsx';
import { useCollection, useData, useQuery } from '../../lib/data.jsx';
import { db } from '../../lib/firebase.js';
import { addDays, date, round3, todayISO } from '../../lib/format.js';
import { ImportButton } from '../../components/ImportExcel.jsx';

export default function Fiscal() {
  const navigate = useNavigate();
  const { products } = useData();
  const fiscal = useCollection('fiscalStock');
  const [tab, setTab] = useState('stock');
  const [onlyDiff, setOnlyDiff] = useState(true);
  const [from, setFrom] = useState(addDays(todayISO(), -60));

  const fiscalById = useMemo(() => Object.fromEntries(fiscal.data.map((f) => [f.id, f])), [fiscal.data]);
  const asOf = fiscal.data.reduce((max, f) => (f.asOf > max ? f.asOf : max), '');

  const rows = products
    .map((p) => {
      const f = fiscalById[p.id];
      const physical = Number(p.qtyTotal || 0);
      const fiscalQty = f ? Number(f.quantity) : 0;
      return { ...p, physical, fiscalQty, hasFiscal: Boolean(f), diff: round3(physical - fiscalQty) };
    })
    .filter((r) => (r.physical || r.hasFiscal) && (!onlyDiff || Math.abs(r.diff) > 0.0005));

  const withoutDoc = useQuery(() => (tab === 'docs'
    ? query(collection(db, 'movements'), where('date', '>=', from), where('status', '==', 'confirmed'))
    : null), [tab, from]);
  const docRows = withoutDoc.data.filter((m) => ['purchase', 'supplier_return', 'customer_return'].includes(m.kind) && !m.fiscalRef);
  const pendingInvoices = useQuery(() => (tab === 'invoices' ? query(collection(db, 'invoices'), where('status', '==', 'pending_fiscal')) : null), [tab]);

  return (
    <>
      <PageHeader
        title="Rakordimi: stoku fizik / fiskal"
        subtitle="Krahason gjendjen fizike në SuperPool me gjendjen fiskale të importuar nga programi i faturimit."
        actions={<ImportButton type="fiscalStock" label="Importo gjendjen fiskale" />}
      />
      <Tabs active={tab} onChange={setTab} tabs={[
        { key: 'stock', label: 'Diferencat e sasive' },
        { key: 'docs', label: 'Hyrje pa dokument fiskal' },
        { key: 'invoices', label: 'Shitje pa numër fiskal' },
      ]} />
      {tab === 'stock' && (
        <>
          <div className="alert info">
            Sasia fizike = mall në magazinë + automjete + kantiere + shitës. {asOf ? `Gjendja fiskale e importuar më: ${date(asOf)}.` : 'Nuk është importuar ende gjendje fiskale.'}
            {' '}Mallrat në automjete/kantiere janë ende pronë e kompanisë derisa të regjistrohen si të përdorura.
          </div>
          <DataTable
            title="Rakordimi i stokut fizik dhe fiskal"
            rows={rows}
            onRowClick={(r) => navigate(`/artikuj/${r.id}`)}
            toolbar={<label className="checkbox"><input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} /> Vetëm me diferencë</label>}
            columns={[
              { key: 'code', label: 'Kodi' },
              { key: 'name', label: 'Artikulli' },
              { key: 'physical', label: 'Fizike', type: 'number' },
              { key: 'fiscalQty', label: 'Fiskale', type: 'number', render: (r) => (r.hasFiscal ? round3(r.fiscalQty).toLocaleString('sq-AL') : <span className="muted">—</span>) },
              { key: 'diff', label: 'Diferenca', type: 'number', render: (r) => <span className={r.diff ? 'text-danger bold' : ''}>{r.diff.toLocaleString('sq-AL')}</span> },
            ]}
          />
        </>
      )}
      {tab === 'docs' && (
        <Card>
          <Field label="Nga data" className="no-print"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ maxWidth: 200 }} /></Field>
          <DataTable
            title="Hyrje pa dokument fiskal"
            rows={docRows}
            onRowClick={(m) => navigate(`/levizjet/${m.id}`)}
            columns={[
              { key: 'date', label: 'Data', render: (m) => date(m.date) },
              { key: 'number', label: 'Nr.' },
              { key: 'kind', label: 'Lloji', value: (m) => MOVEMENT_KINDS[m.kind]?.label },
              { key: 'sourceName', label: 'Nga' },
              { key: 'destName', label: 'Drejt' },
            ]}
          />
        </Card>
      )}
      {tab === 'invoices' && (
        <DataTable
          title="Shitje pa numër fiskal"
          rows={pendingInvoices.data}
          onRowClick={(i) => i.saleId && navigate(`/kimikate/${i.saleId}`)}
          columns={[
            { key: 'date', label: 'Data', render: (i) => date(i.date) },
            { key: 'saleNumber', label: 'Nr. shitjes' },
            { key: 'clientName', label: 'Klienti' },
            { key: 'amount', label: 'Vlera', type: 'money', total: true },
          ]}
        />
      )}
    </>
  );
}
