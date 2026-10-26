import { collection, query, where } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { LOC, MOVEMENT_KINDS } from '@shared/constants.js';
import { CAPS, userHasCap } from '@shared/roles.js';

import { LinesEditor, cleanLines, emptyLine } from '../../components/LinesEditor.jsx';
import { Card, Field, Loading, PageHeader, SearchSelect, useAction } from '../../components/ui.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { unitCostOf, useData, useDocument, useQuery } from '../../lib/data.jsx';
import { call, db } from '../../lib/firebase.js';
import { callOrQueue, newRequestId } from '../../lib/outbox.js';
import { todayISO } from '../../lib/format.js';
import { useRouteId } from '../../lib/prettyUrl.jsx';

const VIRTUAL_BY_KIND = { supplier: LOC.SUPPLIER, customer: LOC.CUSTOMER, consumed: LOC.CONSUMED, loss: LOC.LOSS, adjust: LOC.ADJUST };

const HELP = {
  issue: 'Materialet dalin nga magazina drejt automjetit (ose direkt në kantier). Kërkohet personi që autorizon daljen.',
  delivery: 'Materialet shkarkohen nga automjeti dhe mbeten në kantier, të regjistruara te projekti, deri sa të përdoren.',
  consumption: 'Regjistroni sasinë e përdorur realisht në projekt (nga automjeti ose nga kantieri).',
  return: 'Materialet e mbetura kthehen në magazinë. Shtohen në stok vetëm pasi magazinieri konfirmon gjendjen e tyre.',
  loss: 'Materiale të dëmtuara ose të humbura. Shkruani arsyen; kërkohet miratim.',
  purchase: 'Fletëhyrje nga blerja: shtohet stoku dhe përditësohet kosto mesatare.',
  agent_issue: 'Kimikate që i jepen shitësit (Gertit) për shitje.',
  adjustment: 'Rregullim manual i stokut. Për numërime të plota përdorni "Inventarizimi".',
};

export default function MovementForm() {
  const { kind: kindParam } = useParams();
  const id = useRouteId();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { uid, profile, can, role } = useAuth();
  const data = useData();
  const { locations, locationsById, employees, users, suppliers, clients, vehiclesById, costsById } = data;
  const existing = useDocument(id ? `movements/${id}` : null);
  const existingCosts = useDocument(id && can(CAPS.VIEW_COSTS) ? `movementCosts/${id}` : null);
  const kind = existing.data?.kind || kindParam;
  const def = MOVEMENT_KINDS[kind];
  const canApprove = can(CAPS.MOVEMENTS_APPROVE);
  const isWarehouse = can(CAPS.INVENTORY_MANAGE, CAPS.MOVEMENTS_APPROVE);

  // Projektet që mund të zgjidhen: të gjitha (për përgjegjësit) ose vetëm ato ku punonjësi është në ekip.
  const projects = useQuery(() => (can(CAPS.PROJECTS_VIEW)
    ? query(collection(db, 'projects'), where('status', 'in', ['planned', 'active']))
    : query(collection(db, 'projects'), where('teamUids', 'array-contains', uid))), [uid]);
  const activeProjects = projects.data.filter((p) => ['planned', 'active'].includes(p.status));

  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [run, busy] = useAction();
  const [requestId] = useState(newRequestId); // i njëjti për çdo provë dërgimi të këtij dokumenti
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (form || !def) return;
    if (id && !existing.data) return;
    if (id && can(CAPS.VIEW_COSTS) && existingCosts.loading) return;
    if (existing.data) {
      const m = existing.data;
      const lineCosts = existingCosts.data?.lineCosts || [];
      setForm({
        ...m,
        adjustDir: m.sourceId === LOC.ADJUST ? 'plus' : 'minus',
        lines: (m.lines || []).map((l, i) => ({ ...l, key: `${i}`, unitCost: lineCosts[i] ?? '' })),
      });
      return;
    }
    const myVehicle = Object.values(vehiclesById).find((v) => profile?.employeeId && v.responsibleId === profile.employeeId);
    const pick = (kinds) => {
      if (kinds.length === 1 && VIRTUAL_BY_KIND[kinds[0]]) return VIRTUAL_BY_KIND[kinds[0]];
      if (kinds.includes('main')) return LOC.MAIN;
      if (kinds.includes('vehicle') && myVehicle) return `veh_${myVehicle.id}`;
      return '';
    };
    const projectId = params.get('projekti') || '';
    let destId = params.get('drejt') || pick(def.to);
    if (!params.get('drejt') && kind === 'delivery' && projectId) destId = `site_${projectId}`;
    if (kind === 'issue' && !params.get('drejt')) destId = myVehicle ? `veh_${myVehicle.id}` : '';
    const sourceId = params.get('nga') || pick(def.from);
    if (destId && destId === sourceId) destId = ''; // p.sh. transferimi: burimi dhe destinacioni s'mund të jenë i njëjti vend
    setForm({
      kind,
      date: todayISO(),
      sourceId,
      destId,
      projectId,
      employeeId: profile?.employeeId || '',
      authorizedBy: canApprove ? uid : '',
      supplierId: params.get('furnitori') || '',
      clientId: '',
      fiscalRef: '',
      notes: '',
      adjustDir: 'plus',
      lines: [emptyLine()],
    });
  }, [def, existing.data, existingCosts.loading, existingCosts.data, form, id, kind, params, profile, vehiclesById, canApprove, uid, can]);

  // Gjendja në vendin burim, për t'u shfaqur pranë çdo rreshti.
  const sourceId = form?.kind === 'adjustment' ? (form.adjustDir === 'plus' ? LOC.ADJUST : form.locationId || form.sourceId) : form?.sourceId;
  const sourceIsPhysical = sourceId && locationsById[sourceId] && !locationsById[sourceId].virtual;
  const sourceStock = useQuery(() => (sourceIsPhysical ? query(collection(db, 'stock'), where('locationId', '==', sourceId)) : null), [sourceId, sourceIsPhysical]);
  const available = useMemo(() => (sourceIsPhysical
    ? Object.fromEntries(sourceStock.data.map((s) => [s.productId, Number(s.qty || 0)]))
    : null), [sourceStock.data, sourceIsPhysical]);

  if (!def) return <div className="alert error">Lloj lëvizjeje i panjohur.</div>;
  if (!form) return <Loading />;
  if (id && existing.data && !['draft', 'pending'].includes(existing.data.status)) {
    return <div className="alert warn">Ky dokument nuk mund të ndryshohet më. <Link to={`/levizjet/${id}`}>Kthehu</Link></div>;
  }

  // Vendet e lejuara për burimin / destinacionin sipas llojit të lëvizjes dhe rolit.
  const myProjectIds = new Set(activeProjects.map((p) => p.id));
  const allowedLocation = (l) => {
    if (l.active === false) return false;
    if (isWarehouse) return true;
    if (l.kind === 'vehicle') return vehiclesById[l.vehicleId]?.responsibleId === profile?.employeeId || kind === 'issue';
    if (l.kind === 'site') return myProjectIds.has(l.projectId);
    return l.kind === 'main';
  };
  const locOptions = (kinds) => locations.filter((l) => kinds.includes(l.kind) && allowedLocation(l));
  const onlyVirtual = (kinds) => kinds.length === 1 && VIRTUAL_BY_KIND[kinds[0]];
  const approvers = users.filter((u) => u.active !== false && userHasCap(u, CAPS.MOVEMENTS_APPROVE));

  const priceField = ['purchase', 'customer_return'].includes(kind) && can(CAPS.VIEW_COSTS) ? 'unitCost' : null;
  const needsApproval = def.approval && !canApprove;

  const submit = (submitNow) => {
    const lines = cleanLines(form.lines, priceField);
    if (!lines.length) { setError('Shtoni të paktën një artikull me sasi.'); return; }
    let { sourceId: src, destId: dst } = form;
    if (kind === 'adjustment') {
      src = form.adjustDir === 'plus' ? LOC.ADJUST : form.locationId || form.sourceId;
      dst = form.adjustDir === 'plus' ? form.locationId || form.destId : LOC.ADJUST;
    }
    setError('');
    run(async () => {
      // Dokumentet e reja nga terreni mund të regjistrohen edhe pa internet: ruhen në telefon dhe dërgohen më vonë.
      const res = await (id ? call : (name, data) => callOrQueue(name, data, `${def.label} · ${form.date}`))('submitMovement', {
        id: id || undefined,
        requestId: id ? undefined : requestId,
        submit: submitNow,
        movement: {
          kind,
          date: form.date,
          sourceId: src,
          destId: dst,
          projectId: form.projectId || null,
          employeeId: form.employeeId || null,
          authorizedBy: form.authorizedBy || null,
          supplierId: form.supplierId || null,
          clientId: form.clientId || null,
          fiscalRef: form.fiscalRef || '',
          notes: form.notes || '',
          lines,
        },
      });
      if (res.queued) { navigate(backTo, { replace: true }); return res; }
      navigate(`/levizjet/${res.id}`, { replace: true });
      return res;
    }, (res) => (res.queued ? 'Pa internet: dokumenti u ruajt në telefon dhe do të dërgohet automatikisht sapo të ketë lidhje.' : res.status === 'confirmed' ? `${res.number} u konfirmua.` : res.status === 'pending' ? `${res.number} u dërgua për miratim.` : `${res.number} u ruajt si draft.`));
  };

  const locationSelect = ({ field, kinds, label }) => {
    if (onlyVirtual(kinds)) return null;
    const opts = locOptions(kinds);
    return (
      <Field label={label} required>
        <select value={form[field] || ''} onChange={(e) => set(field, e.target.value)}>
          <option value="">Zgjidh…</option>
          {opts.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </Field>
    );
  };

  const adjustLocationKinds = ['main', 'vehicle', 'site', 'agent'];
  const showProject = ['issue', 'delivery', 'consumption', 'return', 'loss', 'purchase', 'transfer'].includes(kind);
  const backTo = can(CAPS.INVENTORY_VIEW, CAPS.MOVEMENTS_APPROVE) ? '/levizjet' : '/terren';

  return (
    <>
      <PageHeader
        breadcrumb={<Link to={backTo}>{backTo === '/terren' ? 'Terreni' : 'Lëvizjet'}</Link>}
        title={id ? `Ndrysho ${existing.data?.number}` : def.label}
        subtitle={HELP[kind]}
      />
      {error && <div className="alert error">{error}</div>}
      {needsApproval && <div className="alert info">Ky dokument do të kalojë për miratim te përgjegjësi para se të ndryshojë stoku.</div>}
      <Card>
        <div className="form-grid">
          <Field label="Data" required><input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} /></Field>
          {kind === 'adjustment' ? (
            <>
              <Field label="Lloji i rregullimit" required>
                <select value={form.adjustDir} onChange={(e) => set('adjustDir', e.target.value)}>
                  <option value="plus">Shtim (tepricë)</option>
                  <option value="minus">Pakësim (mungesë)</option>
                </select>
              </Field>
              <Field label="Vendi" required>
                <select value={form.locationId || (form.adjustDir === 'plus' ? form.destId : form.sourceId) || ''} onChange={(e) => set('locationId', e.target.value)}>
                  <option value="">Zgjidh…</option>
                  {locOptions(adjustLocationKinds).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </Field>
            </>
          ) : (
            <>
              {locationSelect({ field: 'sourceId', kinds: def.from, label: 'Nga' })}
              {locationSelect({ field: 'destId', kinds: def.to, label: kind === 'issue' ? 'Drejt (automjeti ose kantieri)' : 'Drejt' })}
            </>
          )}
          {showProject && (
            <Field label="Projekti / kantieri" required={def.required.includes('projectId')}>
              <SearchSelect
                options={activeProjects.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}`, sub: p.clientName }))}
                value={form.projectId || ''}
                onChange={(v) => set('projectId', v)}
              />
            </Field>
          )}
          {kind === 'issue' && (
            <>
              <Field label="Punonjësi përgjegjës" required>
                <select value={form.employeeId || ''} onChange={(e) => set('employeeId', e.target.value)}>
                  <option value="">Zgjidh…</option>
                  {employees.filter((e) => e.active !== false).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </Field>
              <Field label="Autorizon daljen" required>
                <select value={form.authorizedBy || ''} onChange={(e) => set('authorizedBy', e.target.value)}>
                  <option value="">Zgjidh…</option>
                  {approvers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </Field>
            </>
          )}
          {['purchase', 'supplier_return'].includes(kind) && (
            <Field label="Furnitori" required>
              <SearchSelect options={suppliers.map((s) => ({ value: s.id, label: s.name, sub: s.nipt }))} value={form.supplierId || ''} onChange={(v) => set('supplierId', v)} />
            </Field>
          )}
          {kind === 'customer_return' && (
            <Field label="Klienti" required>
              <SearchSelect options={clients.map((c) => ({ value: c.id, label: c.name, sub: c.nipt }))} value={form.clientId || ''} onChange={(v) => set('clientId', v)} />
            </Field>
          )}
          {['purchase', 'supplier_return', 'customer_return', 'agent_issue', 'transfer'].includes(kind) && (
            <Field label="Nr. fature / dokumenti fiskal" hint="Numri i dokumentit në programin e faturimit (për rakordim).">
              <input value={form.fiscalRef || ''} onChange={(e) => set('fiscalRef', e.target.value)} />
            </Field>
          )}
          <Field label={kind === 'loss' ? 'Arsyeja / shpjegimi' : 'Shënime'} required={kind === 'loss'} className="span-all">
            <textarea value={form.notes || ''} onChange={(e) => set('notes', e.target.value)} />
          </Field>
        </div>
      </Card>
      <Card title="Artikujt">
        <LinesEditor
          lines={form.lines}
          onChange={(lines) => set('lines', lines)}
          available={available}
          priceField={priceField}
          priceLabel="Kosto njësi"
          defaultPrice={(p) => unitCostOf(costsById, p.id)}
          showCondition={kind === 'return'}
          productFilter={kind === 'agent_issue' ? (p) => p.isChemical : undefined}
        />
      </Card>
      <div className="form-actions">
        <button type="button" className="btn" disabled={busy} onClick={() => navigate(-1)}>Anulo</button>
        <button type="button" className="btn" disabled={busy} onClick={() => submit(false)}>Ruaj si draft</button>
        <button type="button" className="btn primary" disabled={busy} onClick={() => submit(true)}>
          {needsApproval ? 'Dërgo për miratim' : 'Konfirmo'}
        </button>
      </div>
      {role === 'terren' && <p className="muted" style={{ fontSize: '0.85rem' }}>Pas konfirmimit, dokumenti shfaqet te "Terreni" dhe te historiku i automjetit.</p>}
    </>
  );
}
