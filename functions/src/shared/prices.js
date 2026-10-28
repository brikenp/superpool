// Çmimet e artikujve në lekë ose në euro.
//  - products: salePrice (L, me TVSH) dhe, kur çmimi është vendosur në euro, salePriceCurrency='EUR' + salePriceEur
//  - productCosts: purchasePrice/avgCost (L) dhe, kur blerja është në euro, purchaseCurrency='EUR' + purchasePriceEur
// Vlerat në lekë ruhen gjithmonë (për stokun dhe raportet); çmimi origjinal në euro përdoret
// direkt te ofertat/faturat në euro dhe rillogaritet me kursin aktual te ato në lekë.

const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;

/** 'EUR' / 'ALL' nga tekste si "€", "euro", "lek", "L"; null kur është bosh, undefined kur nuk njihet. */
export function parseCurrency(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return null;
  if (['eur', 'euro', 'euro €', '€', 'e'].includes(s)) return 'EUR';
  if (['all', 'lek', 'leke', 'lekë', 'l', 'lk'].includes(s)) return 'ALL';
  return undefined;
}

const isEurSale = (p) => p?.salePriceCurrency === 'EUR' && Number(p.salePriceEur) > 0;
const isEurCost = (c) => c?.purchaseCurrency === 'EUR' && Number(c.purchasePriceEur) > 0;

/** Çmimi i shitjes (me TVSH) në monedhën e dhënë; rate = lekë për 1 €. */
export function salePriceIn(product, currency = 'ALL', rate = 0) {
  if (!product) return 0;
  const rt = Number(rate) > 1 ? Number(rate) : 0;
  if (isEurSale(product)) {
    if (currency === 'EUR') return Number(product.salePriceEur);
    return rt ? r2(Number(product.salePriceEur) * rt) : Number(product.salePrice || 0);
  }
  const all = Number(product.salePrice || 0);
  if (currency === 'EUR') return rt ? r2(all / rt) : 0;
  return all;
}

/** Kosto njësi në monedhën e dhënë (kosto mesatare në lekë, ose çmimi i blerjes në euro për ofertat në euro). */
export function unitCostIn(cost, currency = 'ALL', rate = 0) {
  if (!cost) return 0;
  const rt = Number(rate) > 1 ? Number(rate) : 0;
  if (currency === 'EUR' && isEurCost(cost)) return Number(cost.purchasePriceEur);
  const all = Number(cost.avgCost || cost.purchasePrice || 0);
  if (currency === 'EUR') return rt ? r2(all / rt) : 0;
  return all;
}

/**
 * Fushat që ruhen për një çmim të dhënë në monedhën `currency`.
 * Kthen { all, eur } ku `all` është vlera në lekë (null kur mungon kursi për euro).
 */
export function priceFields(amount, currency, rate) {
  const value = Number(amount);
  if (currency === 'EUR') {
    const rt = Number(rate) > 1 ? Number(rate) : 0;
    return { all: rt ? r2(value * rt) : null, eur: value };
  }
  return { all: value, eur: null };
}
