import { collection, query, where } from 'firebase/firestore';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { PAYMENT_METHODS } from '@shared/constants.js';
import { CAPS } from '@shared/roles.js';

import { DataTable } from '../../components/DataTable.jsx';
import { Card, Field, PageHeader, Stat, StatusBadge, Tabs } from '../../components/ui.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { useData, useQuery } from '../../lib/data.jsx';
import { db } from '../../lib/firebase.js';
import { addDays, date, firstOfMonth, money, todayISO } from '../../lib/format.js';
import { FlowSummary } from '../inventory/LocationDetail.jsx';
import { StockTable } from '../inventory/Stock.jsx';

export const SALE_STATUS = { confirmed: 'Konfirmuar', cancelled: 'Anuluar' };

export default function Sales() {
  const { uid, can } = useAuth();
  const { locations, users } = useData();
  const navigate = useNavigate();
  const seesAll = can(CAPS.CHEM_SALES_ALL, CAPS.REPORTS);
  const [tab, setTab] = useState('sales');
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(todayISO());
  const [seller, setSeller] = useState('');

  const sales = useQuery(() => (seesAll
    ? query(collection(db, 'sales'), where('date', '>=', from), where('date', '<=', to))
    : query(collection(db, 'sales'), where('sellerUid', '==', uid), where('date', '>=', from), where('date', '<=', to))), [seesAll, uid, from, to]);

  const agentLocations = locations.filter((l) => l.kind === 'agent' && l.active !== false && (seesAll || l.agentUid === uid));
  const [agentLoc, setAgentLoc] = useState('');
  const currentAgentLoc = agentLoc || agentLocations[0]?.id || '';
  const agentMoves = useQuery(() => (currentAgentLoc && tab === 'agent'
    ? query(collection(db, 'movements'), where('participants', 'array-contains', uid))
    : null), [currentAgentLoc, tab, uid]);
  const agentMovesAll = useQuery(() => (currentAgentLoc && tab === 'agent' && seesAll
    ? query(collection(db, 'movements'), where('destId', '==', currentAgentLoc))
    : null), [currentAgentLoc, tab, seesAll]);
  const agentMovesOut = useQuery(() => (currentAgentLoc && tab === 'agent' && seesAll
    ? query(collection(db, 'movements'), where('sourceId', '==', currentAgentLoc))
    : null), [currentAgentLoc, tab, seesAll]);
  const flowMoves = useMemo(() => {
    const all = seesAll ? [...agentMovesAll.data, ...agentMovesOut.data] : agentMoves.data;
    return all.filter((m, i, arr) => arr.findIndex((x) => x.id === m.id) === i && (m.sourceId === currentAgentLoc || m.destId === currentAgentLoc));
  }, [seesAll, agentMovesAll.data, agentMovesOut.data, agentMoves.data, currentAgentLoc]);

  const rows = sales.data
    .filter((s) => !seller || s.sellerUid === seller)
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || String(b.number).localeCompare(String(a.number)));
  const active = rows.filter((s) => s.status === 'confirmed');
  const total = active.reduce((s, x) => s + Number(x.total || 0), 0);
  const unpaid = active.filter((s) => s.paymentMethod === 'credit').reduce((s, x) => s + Number(x.total || 0), 0);
  const sellers = users.filter((u) => sales.data.some((s) => s.sellerUid === u.id));

  return (
    <>
      <PageHeader
        title="Shitjet e kimikateve"
        subtitle="Shitjet nga nënmagazina e shitësit ose nga magazina kryesore. Fatura fiskale lëshohet në programin e faturimit."
        actions={<Link className="btn primary" to="/kimikate/shitje-e-re">+ Shitje e re</Link>}
      />
      <Tabs active={tab} onChange={setTab} tabs={[
        { key: 'sales', label: 'Shitjet' },
        agentLocations.length > 0 && { key: 'agent', label: 'Gjendja e nënmagazinës' },
      ]} />
      {tab === 'sales' && (
        <>
          <div className="form-grid" style={{ marginBottom: 12 }}>
            <Field label="Nga data"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label="Deri më"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
            {seesAll && (
              <Field label="Shitësi">
                <select value={seller} onChange={(e) => setSeller(e.target.value)}>
                  <option value="">Të gjithë</option>
                  {sellers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </Field>
            )}
            <Field label="Periudha e shpejtë">
              <select value="" onChange={(e) => { if (e.target.value) { setFrom(addDays(todayISO(), -Number(e.target.value))); setTo(todayISO()); } }}>
                <option value="">—</option>
                <option value="0">Sot</option>
                <option value="7">7 ditët e fundit</option>
                <option value="30">30 ditët e fundit</option>
                <option value="365">12 muajt e fundit</option>
              </select>
            </Field>
          </div>
          <div className="grid grid-3" style={{ marginBottom: 16 }}>
            <Stat label="Shitje në periudhë" value={money(total)} sub={`${active.length} dokumente`} />
            <Stat label="Me afat (pa paguar)" value={money(unpaid)} tone={unpaid > 0 ? 'warn' : ''} />
            <Stat label="Të anuluara" value={rows.length - active.length} sub="në periudhën e zgjedhur" />
          </div>
          <DataTable
            title="Shitjet e kimikateve"
            filtersText={[`Periudha: ${date(from)} – ${date(to)}`]}
            rows={rows}
            onRowClick={(s) => navigate(`/kimikate/${s.id}`)}
            columns={[
              { key: 'date', label: 'Data', render: (s) => date(s.date) },
              { key: 'number', label: 'Nr.' },
              { key: 'clientName', label: 'Klienti' },
              { key: 'products', label: 'Produktet', value: (s) => (s.lines || []).map((l) => `${l.name} ×${l.qty}`).join(', ') },
              { key: 'locationName', label: 'Nga' },
              { key: 'sellerName', label: 'Shitësi', hidden: !seesAll },
              { key: 'paymentMethod', label: 'Pagesa', value: (s) => PAYMENT_METHODS[s.paymentMethod] },
              { key: 'total', label: 'Vlera', type: 'money', total: true, value: (s) => (s.status === 'cancelled' ? 0 : Number(s.total || 0)) },
              { key: 'status', label: 'Statusi', value: (s) => SALE_STATUS[s.status], render: (s) => <StatusBadge status={s.status} labels={SALE_STATUS} /> },
            ]}
          />
        </>
      )}
      {tab === 'agent' && currentAgentLoc && (
        <>
          {agentLocations.length > 1 && (
            <select value={currentAgentLoc} onChange={(e) => setAgentLoc(e.target.value)} style={{ maxWidth: 320, marginBottom: 12 }}>
              {agentLocations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          )}
          <Card title="Gjendja aktuale">
            <StockTable locationIds={[currentAgentLoc]} title="Gjendja e nënmagazinës" />
          </Card>
          <Card title="Marrë / shitur / kthyer — për rakordim">
            <p className="muted" style={{ marginTop: 0 }}>Krahasoni "Mbetja sipas lëvizjeve" me numërimin fizik. Diferencat rregullohen me inventarizim.</p>
            <FlowSummary movements={flowMoves} locationId={currentAgentLoc} title="Rakordimi i nënmagazinës së shitësit" />
          </Card>
        </>
      )}
    </>
  );
}
