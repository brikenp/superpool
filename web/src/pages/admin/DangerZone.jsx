import { TriangleAlert } from 'lucide-react';
import { useState } from 'react';

import { Card, useAction, useUi } from '../../components/ui.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { call } from '../../lib/firebase.js';

// Duhet të përputhet me RESET_GROUPS te functions/src/handlers/reset.js.
const GROUPS = [
  ['transactions', 'Lëvizjet dhe dokumentet', 'Fletëhyrje/dalje, stoku, shitjet, faturat, pagesat, ofertat, projektet, kontratat, porositë, inventarizimet. Sasitë e artikujve bëhen 0 dhe numërimi rifillon nga 0001.', true],
  ['clients', 'Klientët', 'Kartelat e klientëve me dokumentet dhe shënimet.', false],
  ['products', 'Artikujt dhe kategoritë', 'Katalogu i artikujve, kostot, kategoritë dhe çmimet e furnitorëve.', false],
  ['suppliers', 'Furnitorët', '', false],
  ['poolModels', 'Modelet e pishinave', '', false],
  ['fleet', 'Automjetet, punonjësit dhe nënmagazinat', 'Llogaritë e përdoruesve mbeten.', false],
  ['audit', 'Gjurmët e veprimeve', 'Historiku i kush çfarë ka bërë.', false],
];

/** Fshirja e të dhënave të punës (p.sh. pas provave), duke ruajtur konfigurimin. Vetëm administratori. */
export function DangerZone() {
  const { role } = useAuth();
  const { ask } = useUi();
  const [picked, setPicked] = useState(() => GROUPS.filter((g) => g[3]).map((g) => g[0]));
  const [result, setResult] = useState(null);
  const [run, busy] = useAction();
  if (role !== 'admin') return null;
  const toggle = (k) => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));

  const reset = async () => {
    if (!picked.length) return;
    const confirm = await ask({
      title: 'Fshi të dhënat përgjithmonë',
      message: `Do të fshihen: ${GROUPS.filter((g) => picked.includes(g[0])).map((g) => g[1]).join(', ')}.\n\nKy veprim NUK kthehet mbrapsht. Faturat e fiskalizuara mbeten në sistemin e tatimeve edhe pse fshihen këtu.\n\nShkruani FSHI për të vazhduar.`,
      input: 'Shkruani FSHI', confirmLabel: 'Fshi përgjithmonë', danger: true,
    });
    if (!confirm) return;
    run(async () => {
      const res = await call('resetData', { groups: picked, confirm });
      setResult(res.deleted);
      return res;
    }, 'Të dhënat u fshinë. Rifreskoni faqen.');
  };

  return (
    <Card className="danger-zone" title={<span className="row" style={{ gap: 8 }}><TriangleAlert size={18} className="text-danger" /> Zona e rrezikut</span>}>
      <p className="muted" style={{ marginTop: 0 }}>
        Fshin të dhënat e punës (p.sh. pas provave) dhe lë konfigurimin: <b>përdoruesit, të dhënat e kompanisë, lidhja me POS.AL, magazina kryesore</b>.
        Zgjidhni çfarë do të fshihet:
      </p>
      <div className="stack">
        {GROUPS.map(([k, label, hint]) => (
          <label key={k} className="checkbox" style={{ alignItems: 'flex-start' }}>
            <input type="checkbox" checked={picked.includes(k)} onChange={() => toggle(k)} />
            <span><b>{label}</b>{hint && <><br /><small className="muted">{hint}</small></>}</span>
          </label>
        ))}
      </div>
      <button type="button" className="btn danger solid" style={{ marginTop: 14 }} disabled={busy || !picked.length} onClick={reset}>
        <TriangleAlert size={16} /> {busy ? 'Po fshihet…' : 'Fshi të dhënat e zgjedhura'}
      </button>
      {result && (
        <p className="muted" style={{ marginBottom: 0 }}>
          U fshinë: {Object.entries(result).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(' · ') || 'asgjë (ishte bosh)'}.
        </p>
      )}
    </Card>
  );
}
