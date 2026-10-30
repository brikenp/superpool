// Cloud Functions të SuperPool. Të gjitha veprimet që prekin stokun kalojnë nga këtu,
// brenda transaksioneve Firestore, që sasitë të mos prishen kur punojnë disa përdorues njëkohësisht.

export { submitMovement, approveMovement, rejectMovement, cancelMovement } from './handlers/movements.js';
export { confirmSale, cancelSale } from './handlers/sales.js';
export { confirmProduction } from './handlers/production.js';
export { getFiscalConfig, saveFiscalConfig, lookupTaxpayer, fiscalizeInvoice, fiscalInvoicePdf, correctFiscalInvoice } from './handlers/fiscal.js';
export { receivePurchaseOrder, confirmInventoryCount } from './handlers/purchasing.js';
export { reserveProjectMaterials, acceptOffer } from './handlers/projects.js';
export { bootstrap, createUser, updateUser, allocateNumber } from './handlers/admin.js';
export { importData } from './handlers/integration.js';
export { deleteClient, deleteSupplier, deleteProduct, deleteEmployee, deleteVehicle } from './handlers/partners.js';
export { loadImages } from './handlers/files.js';
export { resetData } from './handlers/reset.js';
export { createBackup, listBackups, backupDownloadUrl, deleteBackup, restoreBackup, scheduledBackup } from './handlers/backup.js';
export { onVehicleWritten, onProjectWritten, onEmployeeWritten, auditWrites } from './handlers/triggers.js';
