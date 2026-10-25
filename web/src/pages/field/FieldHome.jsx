import { collection, limit, orderBy, query, where } from 'firebase/firestore';
import { PackageMinus, PackagePlus, TriangleAlert, Undo2, Wrench } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';

import { MOVEMENT_KINDS, MOVEMENT_STATUS, PROJECT_STATUS, UNITS } from '@shared/constants.js';

import { Card, Empty, PageHeader, StatusBadge } from '../../components/ui.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { useData, useQuery } from '../../lib/data.jsx';
import { db } from '../../lib/firebase.js';
import { date, qty } from '../../lib/format.js';
import { ProductThumb } from '../../components/ProductImage.jsx';

/** Ndërfaqja e thjeshtë për telefon: automjeti im, projektet e mia, veprimet e shpejta. */
export default function FieldHome() {
  const { uid, profile } = useAuth();
  const { vehicles, productsById } = useData();
  const navigate = useNavigate();
  const myVehicles = vehicles.filter((v) => v.active !== false && profile?.employeeId && v.responsibleId === profile.employeeId);
  const vehicleLocIds = myVehicles.map((v) => `veh_${v.id}`);
  const stock = useQuery(() => (vehicleLocIds.length ? query(collection(db, 'stock'), where('locationId', 'in', vehicleLocIds.slice(0, 30))) : null), [vehicleLocIds.join(',')]);
  const projects = useQuery(() => query(collection(db, 'projects'), where('teamUids', 'array-contains', uid)), [uid]);
  const moves = useQuery(() => query(collection(db, 'movements'), where('participants', 'array-contains', uid), orderBy('date', 'desc'), limit(15)), [uid]);
  const active = projects.data.filter((p) => ['planned', 'active'].includes(p.status));
  const veh = myVehicles[0];
  const from = veh ? `nga=veh_${veh.id}` : '';

  const actions = [
    { kind: 'issue', icon: PackagePlus, label: 'Merr materiale nga magazina', q: veh ? `drejt=veh_${veh.id}` : '' },
    { kind: 'delivery', icon: PackageMinus, label: 'Dorëzo në kantier', q: from },
    { kind: 'consumption', icon: Wrench, label: 'Regjistro përdorimin', q: from },
    { kind: 'return', icon: Undo2, label: 'Kthe materialet e mbetura', q: from },
  ];

  return (
    <>
      <div className="hero">
        <h1>Përshëndetje, {profile?.name?.split(' ')[0] || ''}</h1>
        <div className="muted">{veh ? `Automjeti juaj: ${veh.plate}` : 'Nuk jeni caktuar përgjegjës i ndonjë automjeti.'}</div>
      </div>
      <div className="field-actions">
        {actions.map((a) => (
          <button key={a.kind} type="button" className="btn big" onClick={() => navigate(`/levizjet/re/${a.kind}${a.q ? `?${a.q}` : ''}`)}>
            <span className="ico"><a.icon size={22} /></span>{a.label}
          </button>
        ))}
      </div>
      <Card title={veh ? `Materialet në automjet (${veh.plate})` : 'Materialet në automjet'} actions={<Link className="btn small" to={`/levizjet/re/loss${from ? `?${from}` : ''}`}><TriangleAlert size={15} /> Dëmtim / humbje</Link>}>
        {stock.data.filter((s) => Number(s.qty) > 0).length ? (
          <ul className="list-plain">
            {stock.data.filter((s) => Number(s.qty) > 0).map((s) => {
              const p = productsById[s.productId] || {};
              return (
                <li key={s.id}>
                  <ProductThumb product={p} size={48} />
                  <span style={{ flex: 1 }}>{p.name}<br /><small className="muted">{p.code}</small></span>
                  <b>{qty(s.qty)} {UNITS[p.unit] || ''}</b>
                </li>
              );
            })}
          </ul>
        ) : <Empty>Automjeti është bosh.</Empty>}
      </Card>
      <Card title="Projektet e mia">
        {active.length ? (
          <ul className="list-plain">
            {active.map((p) => (
              <li key={p.id}>
                <Link to={`/projektet/${p.id}`} style={{ flex: 1 }}>
                  <b>{p.code}</b> · {p.name}<br /><small className="muted">{p.clientName}{p.address ? ` · ${p.address}` : ''}</small>
                </Link>
                <StatusBadge status={p.status} labels={PROJECT_STATUS} />
              </li>
            ))}
          </ul>
        ) : <Empty>Nuk jeni në ekipin e asnjë projekti aktiv.</Empty>}
      </Card>
      <Card title="Dokumentet e mia të fundit">
        {moves.data.length ? (
          <ul className="list-plain">
            {moves.data.map((m) => (
              <li key={m.id}>
                <Link to={`/levizjet/${m.id}`} style={{ flex: 1 }}>
                  {MOVEMENT_KINDS[m.kind]?.label}<br /><small className="muted">{m.number} · {date(m.date)} · {m.destName}</small>
                </Link>
                <StatusBadge status={m.status} labels={MOVEMENT_STATUS} />
              </li>
            ))}
          </ul>
        ) : <Empty>Nuk ka dokumente.</Empty>}
      </Card>
    </>
  );
}
