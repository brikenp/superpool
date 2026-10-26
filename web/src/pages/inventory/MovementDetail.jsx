import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { CONDITIONS, MOVEMENT_KINDS, MOVEMENT_STATUS, UNITS } from '@shared/constants.js';
import { CAPS } from '@shared/roles.js';

import { Card, Loading, PageHeader, StatusBadge, useAction, useUi } from '../../components/ui.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { useData, useDocument } from '../../lib/data.jsx';
import { movementPdf } from '../../lib/docPdf.js';
import { call } from '../../lib/firebase.js';
import { date, dateTime, money, qty } from '../../lib/format.js';
import { ProductThumb } from '../../components/ProductImage.jsx';

export default function MovementDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { uid, can } = useAuth();
  const { ask } = useUi();
  const { employeesById, usersById, suppliersById, clientsById, vehiclesById, productsById, company } = useData();
  const showCosts = can(CAPS.VIEW_COSTS);
  const { data: m, loading } = useDocument(`movements/${id}`);
  const costs = useDocument(showCosts ? `movementCosts/${id}` : null);
  const project = useDocument(m?.projectId ? `projects/${m.projectId}` : null);
  const [conditions, setConditions] = useState(null);
  const [run, busy] = useAction();

  if (loading) return <Loading />;
  if (!m) return <div className="alert error">Dokumenti nuk u gjet ose nuk keni akses.</div>;

  const def = MOVEMENT_KINDS[m.kind];
  const canApprove = can(CAPS.MOVEMENTS_APPROVE);
  const editable = ['draft', 'pending'].includes(m.status) && (m.createdBy === uid || canApprove);
  const lineCosts = costs.data && !costs.data.draft ? costs.data.lineCosts : null;
  const conds = conditions || (m.lines || []).map((l) => l.condition || 'good');
  const extra = {
    project: project.data ? `${project.data.code} · ${project.data.name}` : '',
    vehicle: m.vehicleId ? vehiclesById[m.vehicleId]?.plate : '',
    employee: employeesById[m.employeeId]?.name,
    authorizedBy: usersById[m.authorizedBy]?.name,
    supplier: suppliersById[m.supplierId]?.name,
    client: clientsById[m.clientId]?.name || (m.kind === 'sale' ? m.destName : ''),
  };

  const approve = () => run(() => call('approveMovement', { id, conditions: m.kind === 'return' ? conds : undefined }), 'Dokumenti u miratua dhe stoku u përditësua.');
  const reject = async () => {
    const reason = await ask({ title: 'Refuzo dokumentin', input: 'Arsyeja e refuzimit', confirmLabel: 'Refuzo', danger: true });
    if (reason) run(() => call('rejectMovement', { id, reason }), 'Dokumenti u refuzua.');
  };
  const cancel = async () => {
    const reason = await ask({
      title: 'Anulo dokumentin',
      message: m.status === 'confirmed' ? 'Efekti mbi stokun do të kthehet mbrapsht.' : '',
      input: 'Arsyeja e anulimit',
      confirmLabel: 'Anulo dokumentin',
      danger: true,
    });
    if (reason) run(() => call('cancelMovement', { id, reason }), 'Dokumenti u anulua.');
  };
  const pdf = () => run(() => movementPdf({ movement: m, company, costs: lineCosts, extra }));
  const hasDamaged = conds.some((c) => c !== 'good');

  return (
    <>
      <PageHeader
        breadcrumb={<Link to={can(CAPS.INVENTORY_VIEW, CAPS.MOVEMENTS_APPROVE) ? '/levizjet' : '/terren'}>Lëvizjet</Link>}
        title={`${m.number} · ${def?.label}`}
        subtitle={<><StatusBadge status={m.status} labels={MOVEMENT_STATUS} /> · {date(m.date)}</>}
        actions={(
          <>
            <button type="button" className="btn" onClick={pdf} disabled={busy}>PDF / Printo</button>
            {editable && <button type="button" className="btn" onClick={() => navigate(`/levizjet/${id}/ndrysho`)}>Ndrysho</button>}
            {canApprove && ['pending', 'draft'].includes(m.status) && <button type="button" className="btn ok" disabled={busy} onClick={approve}>Mirato dhe konfirmo</button>}
            {canApprove && m.status === 'pending' && <button type="button" className="btn danger" disabled={busy} onClick={reject}>Refuzo</button>}
            {!['sale', 'production'].includes(m.kind) && !['cancelled', 'rejected'].includes(m.status) && (canApprove || (editable && m.status !== 'confirmed')) && (
              <button type="button" className="btn danger" disabled={busy} onClick={cancel}>Anulo</button>
            )}
          </>
        )}
      />
      {m.status === 'pending' && m.kind === 'return' && canApprove && (
        <div className="alert info">Kontrolloni gjendjen e mallit të kthyer. Artikujt e shënuar si të dëmtuar ose të humbur nuk shtohen në stok, por regjistrohen si humbje{m.projectId ? ' të projektit' : ''}.</div>
      )}
      {m.status === 'rejected' && <div className="alert error">Refuzuar nga {m.rejectedByName}: {m.rejectReason}</div>}
      {m.status === 'cancelled' && <div className="alert error">Anuluar nga {m.cancelledByName} më {dateTime(m.cancelledAt)}: {m.cancelReason}</div>}
      <div className="grid grid-2">
        <Card title="Të dhënat">
          <dl className="props">
            <dt>Nga</dt><dd>{m.sourceName}</dd>
            <dt>Drejt</dt><dd>{m.destName}</dd>
            {extra.project && <><dt>Projekti</dt><dd><Link to={`/projektet/${m.projectId}`}>{extra.project}</Link></dd></>}
            {extra.vehicle && <><dt>Automjeti</dt><dd>{extra.vehicle}</dd></>}
            {extra.employee && <><dt>Punonjësi përgjegjës</dt><dd>{extra.employee}</dd></>}
            {extra.authorizedBy && <><dt>Autorizon</dt><dd>{extra.authorizedBy}</dd></>}
            {extra.supplier && <><dt>Furnitori</dt><dd><Link to={`/furnitoret/${m.supplierId}`}>{extra.supplier}</Link></dd></>}
            {m.clientId && <><dt>Klienti</dt><dd><Link to={`/klientet/${m.clientId}`}>{extra.client}</Link></dd></>}
            {m.fiscalRef && <><dt>Nr. fature / dok. fiskal</dt><dd>{m.fiscalRef}</dd></>}
            {m.purchaseOrderId && <><dt>Porosia</dt><dd><Link to={`/porosite/${m.purchaseOrderId}`}>shiko porosinë</Link></dd></>}
            {m.saleId && <><dt>Shitja</dt><dd><Link to={`/kimikate/${m.saleId}`}>{m.saleNumber || 'shiko shitjen'}</Link></dd></>}
            {m.invoiceNumber && <><dt>Fatura</dt><dd>{m.invoiceNumber}</dd></>}
            {m.produced?.length > 0 && <><dt>Prodhuar për</dt><dd>{m.produced.map((p) => `${p.name} ${p.qty} ${p.unit}`).join(', ')}</dd></>}
          </dl>
        </Card>
        <Card title="Gjurmët">
          <dl className="props">
            <dt>Regjistruar</dt><dd>{m.createdByName} · {dateTime(m.createdAt)}</dd>
            {m.confirmedByName && <><dt>Konfirmuar</dt><dd>{m.confirmedByName} · {dateTime(m.confirmedAt)}</dd></>}
            {showCosts && lineCosts && <><dt>Vlera me kosto</dt><dd>{money(costs.data.total)}</dd></>}
          </dl>
          {m.notes && <p style={{ whiteSpace: 'pre-line' }}><b>Shënime:</b> {m.notes}</p>}
        </Card>
      </div>
      <Card title="Artikujt">
        <div className="table-wrap">
          <table className="table responsive">
            <thead>
              <tr>
                <th>Kodi</th><th>Artikulli</th><th className="r">Sasia</th>
                {m.kind === 'return' && <th>Gjendja</th>}
                {m.kind === 'sale' && <th className="r">Çmimi</th>}
                {showCosts && lineCosts && <><th className="r">Kosto</th><th className="r">Vlera</th></>}
                <th>Shënim</th>
              </tr>
            </thead>
            <tbody>
              {(m.lines || []).map((l, i) => (
                <tr key={i}>
                  <td data-label="Kodi"><span className="product-cell"><ProductThumb product={productsById[l.productId] || l} size={34} /><Link to={`/artikuj/${l.productId}`}>{l.code}</Link></span></td>
                  <td data-label="Artikulli">{l.name}</td>
                  <td data-label="Sasia" className="r">{qty(l.qty)} {UNITS[l.unit] || l.unit}</td>
                  {m.kind === 'return' && (
                    <td data-label="Gjendja">
                      {canApprove && m.status === 'pending' ? (
                        <select value={conds[i]} onChange={(e) => setConditions(conds.map((c, j) => (j === i ? e.target.value : c)))}>
                          {Object.entries(CONDITIONS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                        </select>
                      ) : CONDITIONS[l.condition || 'good']}
                    </td>
                  )}
                  {m.kind === 'sale' && <td data-label="Çmimi" className="r">{money(l.unitPrice)}</td>}
                  {showCosts && lineCosts && (
                    <>
                      <td data-label="Kosto" className="r">{money(lineCosts[i])}</td>
                      <td data-label="Vlera" className="r">{money(lineCosts[i] * l.qty)}</td>
                    </>
                  )}
                  <td data-label="Shënim">{l.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {hasDamaged && m.status === 'pending' && <p className="text-warn">Disa artikuj janë shënuar si të dëmtuar/humbur — nuk do të hyjnë në stok.</p>}
      </Card>
    </>
  );
}
