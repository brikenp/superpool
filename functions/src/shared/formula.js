// Vlerësues i sigurt formulash për rregullat e përllogaritjes së materialeve të pishinave.
// Nuk përdor eval(): ka parserin e vet me aritmetikë, krahasime dhe një listë funksionesh të lejuara.
//
// Shembuj:  "A * 1.1"   "ceil(P / 6)"   "max(2, ceil(V / 40))"   "if(L > 8, 2, 1)"

export const FORMULA_VARIABLES = {
  L: 'Gjatësia (m)',
  W: 'Gjerësia (m)',
  H1: 'Thellësia minimale (m)',
  H2: 'Thellësia maksimale (m)',
  H: 'Thellësia mesatare (m)',
  A: 'Sipërfaqja e pasqyrës së ujit L×W (m²)',
  P: 'Perimetri 2×(L+W) (m)',
  S: 'Sipërfaqja e brendshme: fundi + muret (m²)',
  V: 'Vëllimi i ujit (m³)',
};

export const FORMULA_FUNCTIONS = {
  ceil: (x) => Math.ceil(x),
  floor: (x) => Math.floor(x),
  round: (x, d = 0) => {
    const f = 10 ** d;
    return Math.round(x * f) / f;
  },
  min: (...a) => Math.min(...a),
  max: (...a) => Math.max(...a),
  abs: (x) => Math.abs(x),
  sqrt: (x) => Math.sqrt(x),
};

export class FormulaError extends Error {}

export function poolVariables({ length, width, depthMin, depthMax, volume } = {}) {
  const L = Number(length) || 0;
  const W = Number(width) || 0;
  const H1 = Number(depthMin) || 0;
  const H2 = Number(depthMax) || H1;
  const H = (H1 + H2) / 2;
  const A = L * W;
  const P = 2 * (L + W);
  const S = A + P * H;
  const V = Number(volume) || A * H;
  return { L, W, H1, H2, H, A, P, S, V };
}

function tokenize(text) {
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) { i += 1; continue; }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(text[i + 1] || ''))) {
      let j = i;
      while (j < text.length && /[0-9.]/.test(text[j])) j += 1;
      const raw = text.slice(i, j);
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new FormulaError(`Numër i pavlefshëm: ${raw}`);
      tokens.push({ t: 'num', v: value });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < text.length && /[A-Za-z0-9_]/.test(text[j])) j += 1;
      tokens.push({ t: 'id', v: text.slice(i, j) });
      i = j;
      continue;
    }
    const two = text.slice(i, i + 2);
    if (['<=', '>=', '==', '!=', '&&', '||'].includes(two)) {
      tokens.push({ t: 'op', v: two });
      i += 2;
      continue;
    }
    if ('+-*/%^()<>!,'.includes(ch)) {
      tokens.push({ t: 'op', v: ch });
      i += 1;
      continue;
    }
    throw new FormulaError(`Simbol i palejuar: "${ch}"`);
  }
  return tokens;
}

function parse(tokens, vars) {
  let pos = 0;
  const peek = () => tokens[pos];
  const isOp = (v) => peek() && peek().t === 'op' && peek().v === v;
  const expect = (v) => {
    if (!isOp(v)) throw new FormulaError(`Pritej "${v}"`);
    pos += 1;
  };

  function primary() {
    const tok = peek();
    if (!tok) throw new FormulaError('Formula përfundon papritur');
    if (tok.t === 'num') { pos += 1; return tok.v; }
    if (tok.t === 'id') {
      pos += 1;
      if (isOp('(')) {
        pos += 1;
        const args = [];
        if (!isOp(')')) {
          args.push(orExpr());
          while (isOp(',')) { pos += 1; args.push(orExpr()); }
        }
        expect(')');
        if (tok.v === 'if') {
          if (args.length !== 3) throw new FormulaError('if(kusht, po, jo) kërkon 3 argumente');
          return args[0] ? args[1] : args[2];
        }
        const fn = FORMULA_FUNCTIONS[tok.v];
        if (!fn) throw new FormulaError(`Funksion i panjohur: ${tok.v}`);
        return fn(...args);
      }
      if (!(tok.v in vars)) throw new FormulaError(`Variabël e panjohur: ${tok.v}`);
      return vars[tok.v];
    }
    if (isOp('(')) {
      pos += 1;
      const v = orExpr();
      expect(')');
      return v;
    }
    throw new FormulaError(`Simbol i papritur: ${tok.v}`);
  }

  function power() {
    const base = primary();
    if (isOp('^')) {
      pos += 1;
      const exp = unary();
      if (Math.abs(exp) > 10) throw new FormulaError('Fuqia është shumë e madhe');
      return base ** exp;
    }
    return base;
  }

  function unary() {
    if (isOp('-')) { pos += 1; return -unary(); }
    if (isOp('+')) { pos += 1; return +unary(); }
    if (isOp('!')) { pos += 1; return unary() ? 0 : 1; }
    return power();
  }

  function mul() {
    let v = unary();
    while (isOp('*') || isOp('/') || isOp('%')) {
      const op = tokens[pos].v;
      pos += 1;
      const r = unary();
      if ((op === '/' || op === '%') && r === 0) throw new FormulaError('Pjesëtim me zero');
      v = op === '*' ? v * r : op === '/' ? v / r : v % r;
    }
    return v;
  }

  function add() {
    let v = mul();
    while (isOp('+') || isOp('-')) {
      const op = tokens[pos].v;
      pos += 1;
      const r = mul();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }

  function cmp() {
    const v = add();
    const tok = peek();
    if (tok && tok.t === 'op' && ['<', '<=', '>', '>=', '==', '!='].includes(tok.v)) {
      pos += 1;
      const r = add();
      const res = { '<': v < r, '<=': v <= r, '>': v > r, '>=': v >= r, '==': v === r, '!=': v !== r }[tok.v];
      return res ? 1 : 0;
    }
    return v;
  }

  function andExpr() {
    let v = cmp();
    while (isOp('&&')) { pos += 1; const r = cmp(); v = v && r ? 1 : 0; }
    return v;
  }

  function orExpr() {
    let v = andExpr();
    while (isOp('||')) { pos += 1; const r = andExpr(); v = v || r ? 1 : 0; }
    return v;
  }

  const result = orExpr();
  if (pos < tokens.length) throw new FormulaError(`Simbol i tepërt: ${tokens[pos].v}`);
  return result;
}

/** Vlerëson formulën dhe kthen numër të rrumbullakosur në 3 shifra pas presjes. */
export function evaluateFormula(formula, vars) {
  const text = String(formula ?? '').trim();
  if (!text) return 0;
  if (text.length > 300) throw new FormulaError('Formula është shumë e gjatë');
  const value = parse(tokenize(text), vars);
  if (!Number.isFinite(value)) throw new FormulaError('Rezultati nuk është numër i vlefshëm');
  return Math.round(value * 1000) / 1000;
}

/** Kthen mesazhin e gabimit ose null nëse formula është e vlefshme. */
export function formulaError(formula) {
  try {
    evaluateFormula(formula, poolVariables({ length: 8, width: 4, depthMin: 1.2, depthMax: 1.8 }));
    return null;
  } catch (err) {
    return err.message;
  }
}
