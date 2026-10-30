// Llogaritjet e ofertës: materialet nga modeli i pishinës dhe totalet.

import { DEFAULT_TURNOVER_HOURS, defaultTankPct, evaluateFormula, poolVariables } from '@shared/formula.js';

import { round2, round3, toNumber } from './format.js';

export const newKey = () => Math.random().toString(36).slice(2, 10);

const blank = (x) => x === '' || x === null || x === undefined;

/** % e depos (bosh = sipas llojit të pishinës) dhe orët e qarkullimit (bosh = 4). */
export const offerTankPct = (offer) => (blank(offer.tankPct) ? defaultTankPct(offer.poolType) : toNumber(offer.tankPct));
export const offerTurnoverHours = (offer) => (blank(offer.turnoverHours) || !(toNumber(offer.turnoverHours) > 0) ? DEFAULT_TURNOVER_HOURS : toNumber(offer.turnoverHours));

export function offerVariables(offer) {
  return poolVariables({
    length: offer.length, width: offer.width, depthMin: offer.depthMin, depthMax: offer.depthMax, volume: offer.volumeManual ? offer.volume : null,
    tankPct: offerTankPct(offer), turnoverHours: offerTurnoverHours(offer),
  });
}

export const priceFromCost = (cost, markupPct) => round2(Number(cost || 0) * (1 + Number(markupPct || 0) / 100));

/**
 * Gjeneron rreshtat e ofertës nga modeli. Kthen { lines, errors }.
 * costOf(productId) → kosto njësi aktuale (mesatare ose e fundit e blerjes)
 */
export function linesFromModel(model, offer, { productsById, costOf, toCur = (x) => x }) {
  const vars = offerVariables(offer);
  const errors = [];
  const lines = (model.items || []).map((item) => {
    let qty = 0;
    try {
      qty = evaluateFormula(item.formula, vars);
    } catch (err) {
      errors.push(`${item.description || productsById[item.productId]?.name || 'Rresht'}: ${err.message}`);
    }
    const product = item.productId ? productsById[item.productId] : null;
    // Kostot/çmimet e modelit janë në lekë; toCur i kthen në monedhën e ofertës.
    const unitCost = product ? costOf(item.productId) : toCur(toNumber(item.unitCost));
    const markup = item.markupPct !== '' && item.markupPct !== undefined && item.markupPct !== null ? item.markupPct : model.markupPct;
    const unitPrice = toNumber(item.unitPrice) > 0 ? toCur(toNumber(item.unitPrice)) : priceFromCost(unitCost, markup);
    return {
      key: newKey(),
      section: item.section || 'other',
      productId: item.productId || null,
      code: product?.code || '',
      description: item.description || product?.name || '',
      unit: product?.unit || item.unit || 'cope',
      formula: item.formula || '',
      autoQty: round3(qty),
      qty: round3(qty),
      unitCost: round2(unitCost),
      unitPrice,
      showOnClient: item.showOnClient !== false,
    };
  }).filter((l) => l.qty > 0 || !l.formula);
  return { lines, errors };
}

/** Rillogarit sasitë automatike kur ndryshojnë përmasat, pa prekur rreshtat e ndryshuar me dorë. */
export function recalcQuantities(lines, offer) {
  const vars = offerVariables(offer);
  return lines.map((l) => {
    if (!l.formula) return l;
    let auto;
    try { auto = evaluateFormula(l.formula, vars); } catch { return l; }
    const manual = l.autoQty !== undefined && round3(toNumber(l.qty)) !== round3(l.autoQty);
    return { ...l, autoQty: round3(auto), qty: manual ? l.qty : round3(auto) };
  });
}

export function offerTotals(offer) {
  const lines = offer.lines || [];
  // Oferta me vlerë totale (pa çmime për rresht, si ofertat Excel): totali pa TVSH vendoset me dorë.
  const manual = toNumber(offer.manualSubtotal);
  const subtotal = manual > 0 ? round2(manual) : round2(lines.reduce((s, l) => s + toNumber(l.qty) * toNumber(l.unitPrice), 0));
  const discount = round2(subtotal * toNumber(offer.discountPct) / 100);
  const net = round2(subtotal - discount);
  const vat = round2(net * toNumber(offer.vatPct) / 100);
  const total = round2(net + vat);
  const cost = round2(lines.reduce((s, l) => s + toNumber(l.qty) * toNumber(l.unitCost), 0));
  const margin = round2(net - cost);
  return { subtotal, discount, net, vat, total, cost, margin, marginPct: net > 0 ? round2((margin / net) * 100) : 0 };
}
