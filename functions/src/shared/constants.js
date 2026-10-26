// Llojet e dokumenteve, statuset dhe vendet e magazinimit.

export const LOCATION_KINDS = {
  main: 'Magazinë',
  vehicle: 'Automjet',
  site: 'Kantier',
  agent: 'Nënmagazinë shitësi',
  supplier: 'Furnitor (virtual)',
  customer: 'Klient (virtual)',
  consumed: 'Përdorur në projekt (virtual)',
  loss: 'Dëmtuar / humbur (virtual)',
  adjust: 'Rregullim inventari (virtual)',
  production: 'Prodhim (virtual)',
};

export const VIRTUAL_KINDS = ['supplier', 'customer', 'consumed', 'loss', 'adjust', 'production'];

// ID fikse për vendet virtuale dhe për magazinën kryesore.
export const LOC = {
  MAIN: 'main',
  SUPPLIER: 'v_supplier',
  CUSTOMER: 'v_customer',
  CONSUMED: 'v_consumed',
  LOSS: 'v_loss',
  ADJUST: 'v_adjust',
  PRODUCTION: 'v_production',
};

export const VIRTUAL_LOCATIONS = {
  [LOC.SUPPLIER]: { kind: 'supplier', name: 'Furnitorë' },
  [LOC.CUSTOMER]: { kind: 'customer', name: 'Klientë' },
  [LOC.CONSUMED]: { kind: 'consumed', name: 'Përdorur në projekte' },
  [LOC.LOSS]: { kind: 'loss', name: 'Dëmtuar / humbur' },
  [LOC.ADJUST]: { kind: 'adjust', name: 'Rregullime inventari' },
  [LOC.PRODUCTION]: { kind: 'production', name: 'Prodhim' },
};

export const isVirtualLocation = (id) => Object.prototype.hasOwnProperty.call(VIRTUAL_LOCATIONS, id);

// Për çdo lloj lëvizjeje: etiketa, prefiksi i numrit, llojet e lejuara të vendeve burim/destinacion,
// nëse kërkon miratim kur e regjistron dikush pa të drejtë miratimi, dhe fushat e detyrueshme.
export const MOVEMENT_KINDS = {
  purchase: {
    label: 'Hyrje nga blerja', prefix: 'HYR', from: ['supplier'], to: ['main', 'agent'],
    approval: false, required: ['supplierId'],
  },
  issue: {
    label: 'Dalje drejt automjetit / kantierit', prefix: 'DAL', from: ['main'], to: ['vehicle', 'site'],
    approval: true, required: ['employeeId', 'authorizedBy'],
  },
  delivery: {
    label: 'Dorëzim në kantier', prefix: 'DOR', from: ['vehicle'], to: ['site'], approval: false,
    required: ['projectId'],
  },
  consumption: {
    label: 'Përdorim në projekt', prefix: 'PRD', from: ['vehicle', 'site', 'main'], to: ['consumed'],
    approval: false, required: ['projectId'],
  },
  return: {
    label: 'Kthim në magazinë', prefix: 'KTH', from: ['vehicle', 'site', 'agent'], to: ['main'],
    approval: true, required: [],
  },
  transfer: {
    label: 'Transferim', prefix: 'TRF', from: ['main', 'vehicle', 'site', 'agent'],
    to: ['main', 'vehicle', 'site', 'agent'], approval: true, required: [],
  },
  agent_issue: {
    label: 'Dalje drejt shitësit (kimikate)', prefix: 'DSH', from: ['main'], to: ['agent'], approval: true,
    required: [],
  },
  sale: {
    label: 'Shitje', prefix: 'SHT', from: ['main', 'agent', 'vehicle'], to: ['customer'], approval: false,
    required: ['clientId'],
  },
  customer_return: {
    label: 'Kthim nga klienti', prefix: 'KKL', from: ['customer'], to: ['main', 'agent'], approval: true,
    required: ['clientId'],
  },
  supplier_return: {
    label: 'Kthim te furnitori', prefix: 'KFU', from: ['main'], to: ['supplier'], approval: true,
    required: ['supplierId'],
  },
  loss: {
    label: 'Dëmtim / humbje', prefix: 'HUM', from: ['main', 'vehicle', 'site', 'agent'], to: ['loss'],
    approval: true, required: ['notes'],
  },
  // Krijohet automatikisht kur shitet një artikull i përbërë (receta): materialet dalin nga magazina.
  production: {
    label: 'Prodhim (dalje materialesh)', prefix: 'PRO', from: ['main', 'agent', 'vehicle'], to: ['production'],
    approval: false, required: [],
  },
  adjustment: {
    label: 'Rregullim inventari', prefix: 'INV', from: ['adjust', 'main', 'vehicle', 'site', 'agent'],
    to: ['adjust', 'main', 'vehicle', 'site', 'agent'], approval: true, required: [],
  },
};

export const MOVEMENT_STATUS = {
  draft: 'Draft',
  pending: 'Në pritje të miratimit',
  confirmed: 'Konfirmuar',
  rejected: 'Refuzuar',
  cancelled: 'Anuluar',
};

export const CONDITIONS = {
  good: 'Në gjendje të mirë',
  damaged: 'I dëmtuar',
  lost: 'I humbur',
};

export const UNITS = {
  cope: 'copë', m: 'm', m2: 'm²', m3: 'm³', kg: 'kg', l: 'litër', pako: 'pako', set: 'set', rrotull: 'rrotull',
  ore: 'orë',
};

export const PROJECT_STATUS = {
  planned: 'Në planifikim',
  active: 'Aktiv',
  completed: 'Përfunduar',
  cancelled: 'Anuluar',
};

export const OFFER_STATUS = {
  draft: 'Draft',
  sent: 'Dërguar klientit',
  accepted: 'Pranuar',
  rejected: 'Refuzuar',
  expired: 'Skaduar',
};

export const PO_STATUS = {
  draft: 'Draft',
  sent: 'Dërguar furnitorit',
  confirmed: 'Konfirmuar nga furnitori',
  partial: 'Pranuar pjesërisht',
  received: 'Pranuar plotësisht',
  cancelled: 'Anuluar',
};

export const PAYMENT_METHODS = {
  cash: 'Cash',
  bank: 'Bankë',
  card: 'Kartë',
  credit: 'Me afat (pa paguar)',
};

export const EXPENSE_CATEGORIES = {
  labor: 'Punë / orë pune',
  transport: 'Transport',
  subcontractor: 'Nënkontraktor',
  equipment: 'Makineri / qira',
  other: 'Tjetër',
};

export const POOL_SECTIONS = {
  structure: 'Strukturë dhe punime ndërtimi',
  piping: 'Tubacione dhe rakorderi',
  inlets: 'Elemente thithjeje dhe kthimi',
  filtration: 'Filtra dhe pompa',
  dosing: 'Dozim dhe trajtim uji',
  lighting: 'Ndriçim',
  finish: 'Hidroizolim dhe veshje',
  electrical: 'Kuadër elektrik dhe aksesorë',
  assembly: 'Materiale montimi',
  services: 'Shërbime dhe punë',
  other: 'Të tjera',
};

export const POOL_TYPES = {
  skimmer: 'Me skimer',
  overflow: 'Me tejderdhje (overflow)',
  infinity: 'Infinity',
  prefabricated: 'E parafabrikuar',
  other: 'Tjetër',
};

export const CONTRACT_STATUS = {
  draft: 'Draft',
  signed: 'Nënshkruar',
  active: 'Në zbatim',
  completed: 'Përfunduar',
  cancelled: 'Anuluar',
};

// Monedhat e faturave. Shumat në EUR ruhen edhe në lekë (amountAll) me kursin e ditës së faturës.
export const CURRENCIES = {
  ALL: { label: 'Lekë (ALL)', symbol: 'L', words: ['lekë', 'qindarka'] },
  EUR: { label: 'Euro (EUR)', symbol: '€', words: ['euro', 'cent'] },
};
