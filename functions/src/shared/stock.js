// Logjika e pastër (pa Firestore) për efektin e një lëvizjeje mbi stokun, kostot dhe projektin.
// Përdoret brenda transaksioneve në Cloud Functions dhe testohet më vete.

import { LOC, MOVEMENT_KINDS, VIRTUAL_KINDS } from './constants.js';

export const stockKey = (locationId, productId) => `${locationId}__${productId}`;

const round3 = (n) => Math.round(n * 1000) / 1000;
const round2 = (n) => Math.round(n * 100) / 100;

export const isPhysicalKind = (kind) => !VIRTUAL_KINDS.includes(kind);

/** Destinacioni efektiv i një rreshti: në kthim, mallrat e dëmtuara/humbura shkojnë te "Dëmtuar / humbur". */
export function lineDestination(movement, line) {
  if (line.destId) return line.destId; // përdoret vetëm nga serveri (p.sh. materialet e prodhimit)
  if (movement.kind === 'return' && line.condition && line.condition !== 'good') return LOC.LOSS;
  return movement.destId;
}

/** Validon strukturën e lëvizjes (pa e prekur stokun). Kthen listë gabimesh. */
export function validateMovement(movement, locations) {
  const errors = [];
  const def = MOVEMENT_KINDS[movement.kind];
  if (!def) return [`Lloj lëvizjeje i panjohur: ${movement.kind}`];
  const src = locations[movement.sourceId];
  const dst = locations[movement.destId];
  if (!src) errors.push('Vendi burim nuk ekziston.');
  if (!dst) errors.push('Vendi destinacion nuk ekziston.');
  if (src && !def.from.includes(src.kind)) errors.push(`"${def.label}" nuk mund të nisë nga ${src.name}.`);
  if (dst && !def.to.includes(dst.kind)) errors.push(`"${def.label}" nuk mund të shkojë te ${dst.name}.`);
  if (movement.sourceId && movement.sourceId === movement.destId) errors.push('Burimi dhe destinacioni janë të njëjtë.');
  if (src && dst && movement.kind === 'adjustment' && src.kind !== 'adjust' && dst.kind !== 'adjust') {
    errors.push('Rregullimi duhet të jetë nga ose drejt "Rregullime inventari".');
  }
  for (const field of def.required) {
    if (!movement[field] || (typeof movement[field] === 'string' && !movement[field].trim())) {
      errors.push(`Fusha "${REQUIRED_LABELS[field] || field}" është e detyrueshme.`);
    }
  }
  if (!Array.isArray(movement.lines) || movement.lines.length === 0) errors.push('Shtoni të paktën një artikull.');
  (movement.lines || []).forEach((line, i) => {
    if (!line.productId) errors.push(`Rreshti ${i + 1}: zgjidhni artikullin.`);
    if (!(Number(line.qty) > 0)) errors.push(`Rreshti ${i + 1}: sasia duhet të jetë më e madhe se zero.`);
  });
  return errors;
}

const REQUIRED_LABELS = {
  supplierId: 'Furnitori',
  employeeId: 'Punonjësi përgjegjës',
  authorizedBy: 'Personi që autorizon',
  projectId: 'Projekti',
  clientId: 'Klienti',
  notes: 'Shënime / arsyeja',
};

/**
 * Llogarit efektin e lëvizjes.
 *
 * @param movement  { kind, sourceId, destId, projectId, lines: [{productId, qty, condition, unitCost}] }
 * @param ctx       { locations: {id:{kind,name}}, stock: {key: qty}, products: {id:{name, avgCost, purchasePrice, qtyTotal}} }
 * @param direction 1 = zbatim, -1 = anulim (kthim mbrapsht i një lëvizjeje të konfirmuar)
 */
export function planMovement(movement, ctx, direction = 1) {
  const { locations, stock, products } = ctx;
  const stockDeltas = {};
  const productDeltas = {};
  const projectDeltas = {};
  const lineCosts = [];
  const errors = [];

  const addStock = (locId, productId, delta) => {
    const loc = locations[locId];
    if (!loc || !isPhysicalKind(loc.kind)) return;
    const key = stockKey(locId, productId);
    stockDeltas[key] = round3((stockDeltas[key] || 0) + delta);
    const pd = (productDeltas[productId] ||= { qtyTotal: 0, qtyMain: 0 });
    pd.qtyTotal = round3(pd.qtyTotal + delta);
    if (loc.kind === 'main') pd.qtyMain = round3(pd.qtyMain + delta);
  };
  const addProject = (productId, field, delta) => {
    const pd = (projectDeltas[productId] ||= {});
    pd[field] = round3((pd[field] || 0) + delta);
  };

  const srcKind = locations[movement.sourceId]?.kind;
  // Malli që hyn me kosto të re: blerjet, kthimet nga klienti dhe artikujt e prodhuar.
  const costIn = (line) => movement.kind === 'purchase' || movement.kind === 'customer_return'
    || (movement.kind === 'production' && line.sourceId === LOC.PRODUCTION);

  for (const line of movement.lines) {
    const qty = Number(line.qty);
    const product = products[line.productId] || {};
    const dest = lineDestination(movement, line);
    let unitCost;
    if (costIn(line)) {
      unitCost = Number(line.unitCost ?? product.avgCost ?? product.purchasePrice ?? 0) || 0;
    } else if (direction === -1 && line.unitCost != null) {
      unitCost = Number(line.unitCost);
    } else {
      unitCost = Number(product.avgCost || product.purchasePrice || 0);
    }
    lineCosts.push(round2(unitCost));

    const q = qty * direction;
    addStock(line.sourceId || movement.sourceId, line.productId, -q);
    addStock(dest, line.productId, q);

    if (movement.projectId) {
      switch (movement.kind) {
        case 'purchase': addProject(line.productId, 'purchased', q); break;
        case 'issue': addProject(line.productId, 'issued', q); break;
        case 'delivery': addProject(line.productId, 'delivered', q); break;
        case 'consumption':
          addProject(line.productId, 'consumed', q);
          if (srcKind === 'main') addProject(line.productId, 'issued', q);
          break;
        case 'return':
          addProject(line.productId, dest === LOC.LOSS ? 'loss' : 'returned', q);
          break;
        case 'loss': addProject(line.productId, 'loss', q); break;
        default: break;
      }
    }
  }

  // Kontrolli i stokut negativ në vendet fizike.
  for (const [key, delta] of Object.entries(stockDeltas)) {
    if (delta >= 0) continue;
    const current = Number(stock[key] || 0);
    if (round3(current + delta) < 0) {
      const [locId, productId] = key.split('__');
      const name = products[productId]?.name || productId;
      const locName = locations[locId]?.name || locId;
      errors.push(`Stok i pamjaftueshëm për "${name}" në ${locName}: gjendje ${current}, kërkohet ${-delta}.`);
    }
  }

  // Kosto mesatare e ponderuar: ndryshon vetëm kur hyn mall nga jashtë me kosto të re.
  const avgCosts = {};
  if (movement.lines.some(costIn)) {
    const byProduct = {};
    movement.lines.forEach((line, i) => {
      if (!costIn(line)) return;
      const b = (byProduct[line.productId] ||= { qty: 0, value: 0 });
      b.qty += Number(line.qty);
      b.value += Number(line.qty) * lineCosts[i];
    });
    for (const [productId, { qty, value }] of Object.entries(byProduct)) {
      const p = products[productId] || {};
      const oldQty = Math.max(0, Number(p.qtyTotal || 0));
      const oldAvg = Number(p.avgCost || 0);
      if (direction === 1) {
        const total = oldQty + qty;
        avgCosts[productId] = total > 0 ? round2((oldQty * oldAvg + value) / total) : oldAvg;
      } else {
        const remaining = oldQty - qty;
        avgCosts[productId] = remaining > 0 ? round2(Math.max(0, (oldQty * oldAvg - value) / remaining)) : oldAvg;
      }
    }
  }

  return { stockDeltas, productDeltas, projectDeltas, lineCosts, avgCosts, errors };
}

/** Sasia e rezervuar që ende nuk ka dalë nga magazina. */
export const openReserved = (reserved, issued) => Math.max(0, round3(Number(reserved || 0) - Number(issued || 0)));

/** Pasqyra e materialeve të një projekti për një artikull. */
export function projectMaterialSummary(m = {}, onSite = 0) {
  const planned = Number(m.plannedQty || 0);
  const issued = Number(m.issued || 0);
  const consumed = Number(m.consumed || 0);
  const returned = Number(m.returned || 0);
  const loss = Number(m.loss || 0);
  const inField = round3(issued - consumed - returned - loss);
  return {
    planned,
    reserved: Number(m.reservedQty || 0),
    purchased: Number(m.purchased || 0),
    issued,
    delivered: Number(m.delivered || 0),
    consumed,
    returned,
    loss,
    onSite: round3(onSite),
    inVehicles: round3(inField - onSite),
    variance: round3(consumed + loss - planned),
    needsAttention: loss > 0 || (planned > 0 && consumed + loss > planned),
  };
}

/** Rezultati financiar i projektit. */
export function projectResult({ contractValue = 0, plannedMaterialCost = 0, plannedOtherCost = 0,
  realMaterialCost = 0, expenses = 0, invoiced = 0, paid = 0 }) {
  const plannedCost = round2(plannedMaterialCost + plannedOtherCost);
  const realCost = round2(realMaterialCost + expenses);
  return {
    contractValue: round2(contractValue),
    plannedCost,
    realCost,
    costVariance: round2(realCost - plannedCost),
    plannedMargin: round2(contractValue - plannedCost),
    realMargin: round2(contractValue - realCost),
    realMarginPct: contractValue > 0 ? round2(((contractValue - realCost) / contractValue) * 100) : 0,
    invoiced: round2(invoiced),
    paid: round2(paid),
    outstanding: round2(invoiced - paid),
    notInvoiced: round2(contractValue - invoiced),
  };
}

/**
 * Materialet që duhen për sasinë e dhënë të artikujve të përbërë.
 * lines: [{ productId, qty }], products: { id: { recipe: [{ productId, qty }] } }
 * Kthen [{ productId, qty }] të grupuara sipas materialit.
 */
export function explodeRecipes(lines, products) {
  const out = {};
  for (const l of lines) {
    for (const c of products[l.productId]?.recipe || []) {
      if (!c.productId || !(Number(c.qty) > 0)) continue;
      out[c.productId] = round3((out[c.productId] || 0) + Number(c.qty) * Number(l.qty));
    }
  }
  return Object.entries(out).map(([productId, qty]) => ({ productId, qty }));
}

/**
 * Rreshtat e një fletë prodhimi: materialet dalin nga vendi drejt "Prodhim",
 * artikujt e prodhuar hyjnë nga "Prodhim" në të njëjtin vend, me koston e materialeve.
 * items: [{ productId, qty }] (artikuj me recetë)
 */
export function productionLines(items, products, locationId) {
  const components = explodeRecipes(items, products).map((c) => ({ productId: c.productId, qty: c.qty, condition: 'good', note: '' }));
  const outputs = items.filter((i) => Number(i.qty) > 0).map((i) => ({
    productId: i.productId,
    qty: round3(Number(i.qty)),
    condition: 'good',
    note: '',
    sourceId: LOC.PRODUCTION,
    destId: locationId,
    unitCost: recipeUnitCost(products[i.productId], products),
  }));
  return [...components, ...outputs];
}

/** Kosto e materialeve për 1 njësi të artikullit me recetë. */
export function recipeUnitCost(product, products) {
  return round2((product?.recipe || []).reduce((s, c) => {
    const p = products[c.productId] || {};
    return s + Number(c.qty || 0) * Number(p.avgCost || p.purchasePrice || 0);
  }, 0));
}

export const isComposite = (product) => Array.isArray(product?.recipe) && product.recipe.some((c) => c.productId && Number(c.qty) > 0);
