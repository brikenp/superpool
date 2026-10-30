import { ref, uploadBytes } from 'firebase/storage';
import { ArchiveRestore, DatabaseBackup, Download, Trash2, Upload } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { DataTable } from '../../components/DataTable.jsx';
import { Card, Field, Modal, PageHeader, Stat, useAction, useUi } from '../../components/ui.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { useDocument } from '../../lib/data.jsx';
import { call, storage } from '../../lib/firebase.js';
import { dateTime } from '../../lib/format.js';

const size = (b) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const when = (iso) => (iso ? dateTime(new Date(iso)) : '');

/** Kopjet rezervë: krijim, shkarkim në kompjuter, ngarkim dhe rikthim. Vetëm administratori. */
export default function Backups() {
  const { role } = useAuth();
  const { ask } = useUi();
  const status = useDocument('settings/backup');
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState(null);
  const [result, setResult] = useState(null);
  const [downloading, setDownloading] = useState('');
  const [run, busy] = useAction();

  const refresh = useCallback(() => {
    setLoading(true);
    call('listBackups').then(setList).catch(() => setList([])).finally(() => setLoading(false));
  }, []);
  useEffect(() => { if (role === 'admin') refresh(); }, [role, refresh]);

  if (role !== 'admin') return <div className="alert error">Vetëm administratori menaxhon kopjet rezervë.</div>;

  const create = () => run(async () => {
    const note = await ask({ title: 'Krijo kopje rezervë tani', message: 'Ruhen të gjitha të dhënat, fotot, dokumentet dhe llogaritë e përdoruesve.', input: 'Shënim (opsional)', required: false, confirmLabel: 'Krijo kopjen' });
    if (note === null || note === false || note === undefined) return null;
    const res = await call('createBackup', { note: typeof note === 'string' ? note : '' });
    refresh();
    return res;
  }, (r) => r && `Kopja u krijua: ${r.docs} dokumente, ${r.files} skedarë, ${r.users} përdorues.`);

  // Shkarkimi bëhet me lidhje nga serveri (jo me getBlob, që kërkon CORS në bucket dhe mbetet duke pritur).
  const download = async (b) => {
    setDownloading(b.name);
    try {
      const { url, filename } = await call('backupDownloadUrl', { name: b.name });
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      run(() => Promise.reject(err));
    } finally {
      setDownloading('');
    }
  };

  const upload = (file) => run(async () => {
    if (!file.name.endsWith('.spbak')) throw new Error('Zgjidhni një skedar kopjeje rezervë të SuperPool (.spbak).');
    const name = `backups/uploads/${new Date().toISOString().replace(/[:.]/g, '-')}_upload.spbak`;
    await uploadBytes(ref(storage, name), file, { contentType: 'application/gzip' });
    refresh();
  }, 'Kopja u ngarkua. Tani mund ta riktheni nga lista.');

  const remove = async (b) => {
    const ok = await ask({ title: 'Fshi kopjen rezervë', message: `Kopja e ${when(b.createdAt)} do të fshihet përgjithmonë.`, confirmLabel: 'Fshi', danger: true });
    if (ok) run(async () => { await call('deleteBackup', { name: b.name }); refresh(); }, 'Kopja u fshi.');
  };

  const latest = list[0];
  return (
    <>
      <PageHeader
        title="Kopjet rezervë"
        subtitle="Ruani gjithë platformën dhe riktheni çdo gjë nëse të dhënat fshihen ose prishen."
        actions={(
          <>
            <label className="btn">
              <Upload size={16} /> Ngarko kopje nga kompjuteri
              <input type="file" accept=".spbak" hidden disabled={busy} onChange={(e) => { if (e.target.files[0]) upload(e.target.files[0]); e.target.value = ''; }} />
            </label>
            <button type="button" className="btn primary" disabled={busy} onClick={create}><DatabaseBackup size={16} /> Krijo kopje tani</button>
          </>
        )}
      />
      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Stat label="Kopja e fundit" value={latest ? when(latest.createdAt) : '—'} sub={latest ? `${latest.kindLabel} · ${latest.docs} dokumente` : 'Ende asnjë kopje'} />
        <Stat label="Kopja automatike e fundit" value={status.data?.lastAutoAt ? dateTime(status.data.lastAutoAt) : '—'} sub="Çdo natë në 02:30, mbahen 30 të fundit" />
        <Stat label="Kopje të ruajtura" value={String(list.length)} />
        <Stat label="Rikthimi i fundit" value={status.data?.lastRestoreAt ? dateTime(status.data.lastRestoreAt) : '—'} sub={status.data?.lastRestoreBy || ''} />
      </div>
      <div className="alert info"><div>
        Çdo kopje përmban <b>të gjitha të dhënat</b> (artikuj, stok, lëvizje, klientë, furnitorë, oferta, projekte, fatura, pagesa, bankat, cilësimet, përdoruesit…),
        {' '}<b>fotot dhe dokumentet</b> e ngarkuara dhe <b>llogaritë e hyrjes</b>. Kopjet ruhen në Firebase Storage; për siguri të plotë shkarkoni herë pas here një kopje në kompjuter ose në një disk tjetër.
        {'\n'}Para çdo rikthimi sistemi krijon vetë një kopje të gjendjes aktuale («Para rikthimit»), që rikthimi të mund të zhbëhet.
      </div></div>
      {result && (
        <div className="alert ok"><div>
          Rikthimi përfundoi: {result.docs} dokumente u rikthyen{result.skipped ? `, ${result.skipped} ekzistonin dhe u lanë siç ishin` : ''}, {result.files} skedarë.
          {result.usersCreated.length > 0 && <>{'\n'}U rikrijuan llogaritë e hyrjes: {result.usersCreated.join(', ')} — vendosuni fjalëkalim të ri te Përdoruesit.</>}
          {'\n'}Gjendja para rikthimit u ruajt si kopje «Para rikthimit». Rifreskoni faqen për të parë të dhënat.
        </div></div>
      )}
      <Card title="Kopjet e ruajtura">
        <DataTable
          title="Kopjet rezervë"
          rows={list.map((b) => ({ ...b, id: b.name }))}
          empty={loading ? 'Duke ngarkuar…' : 'Ende asnjë kopje. Klikoni «Krijo kopje tani».'}
          columns={[
            { key: 'createdAt', label: 'Data', render: (b) => when(b.createdAt), value: (b) => b.createdAt },
            { key: 'kindLabel', label: 'Lloji' },
            { key: 'docs', label: 'Dokumente', type: 'number' },
            { key: 'files', label: 'Skedarë', type: 'number' },
            { key: 'users', label: 'Përdorues', type: 'number' },
            { key: 'size', label: 'Madhësia', value: (b) => b.size, render: (b) => size(b.size) },
            { key: 'createdBy', label: 'Nga' },
            { key: 'note', label: 'Shënim' },
            {
              key: 'actions', label: '', export: false, sortable: false,
              render: (b) => (
                <span className="row" style={{ gap: 4, flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
                  <button type="button" className="btn small" disabled={Boolean(downloading)} title="Shkarko në kompjuter" onClick={() => download(b)}>{downloading === b.name ? '…' : <Download size={14} />}</button>
                  <button type="button" className="btn small" disabled={busy} onClick={() => setRestoring(b)}><ArchiveRestore size={14} /> Rikthe</button>
                  <button type="button" className="btn small danger" disabled={busy} title="Fshi" onClick={() => remove(b)}><Trash2 size={14} /></button>
                </span>
              ),
            },
          ]}
        />
      </Card>
      {restoring && <RestoreModal backup={restoring} onClose={() => setRestoring(null)} onDone={(r) => { setResult(r); setRestoring(null); refresh(); }} />}
    </>
  );
}

function RestoreModal({ backup, onClose, onDone }) {
  const [mode, setMode] = useState('missing');
  const [confirm, setConfirm] = useState('');
  const [run, busy] = useAction();
  const restore = () => run(async () => {
    const res = await call('restoreBackup', { name: backup.name, mode, confirm });
    onDone(res);
    return res;
  }, 'Rikthimi përfundoi.');
  return (
    <Modal title={`Rikthe kopjen e ${when(backup.createdAt)}`} onClose={busy ? undefined : onClose}
      footer={(
        <>
          <button type="button" className="btn" disabled={busy} onClick={onClose}>Anulo</button>
          <button type="button" className="btn danger" disabled={busy || confirm.trim().toUpperCase() !== 'RIKTHE'} onClick={restore}>
            {busy ? 'Duke rikthyer… (mund të zgjasë disa minuta)' : 'Rikthe'}
          </button>
        </>
      )}>
      <p style={{ marginTop: 0 }}>{backup.kindLabel} · {backup.docs} dokumente · {backup.files} skedarë · {backup.users} përdorues{backup.note ? ` · ${backup.note}` : ''}</p>
      <div style={{ display: 'grid', gap: 10 }}>
        <label className="checkbox" style={{ alignItems: 'flex-start' }}>
          <input type="radio" name="mode" checked={mode === 'missing'} onChange={() => setMode('missing')} />
          <span><b>Rikthe vetëm çfarë mungon</b> (e sigurt)<br /><small className="muted">Shtohen dokumentet dhe skedarët e fshirë. Asgjë që ekziston sot nuk ndryshohet. Përdoreni pas një fshirjeje aksidentale.</small></span>
        </label>
        <label className="checkbox" style={{ alignItems: 'flex-start' }}>
          <input type="radio" name="mode" checked={mode === 'replace'} onChange={() => setMode('replace')} />
          <span><b>Rikthe plotësisht si në kopje</b><br /><small className="muted">Të dhënat bëhen saktësisht si në datën e kopjes; çdo ndryshim i bërë pas saj humbet (por ruhet te kopja «Para rikthimit»).</small></span>
        </label>
      </div>
      <Field label="Shkruani RIKTHE për të konfirmuar" className="span-all">
        <input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="RIKTHE" />
      </Field>
    </Modal>
  );
}
