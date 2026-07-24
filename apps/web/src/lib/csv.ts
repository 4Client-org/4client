import { STATUS_LABEL, PAYMENT_LABEL } from './format';

const DECISION_LABEL: Record<string, string> = {
  manana: 'Pasar a mañana',
  forzar_cierre: 'Cerrar sin cobro',
  '': 'Sin decidir',
};

// customer_name/address originate from untrusted input (a WhatsApp contact's own
// display name, or an address the client typed on the public form) and this file is
// the real cash-reconciliation report staff hand off to accounting - so both a
// literal " and a formula-injection attempt need neutralizing, not just wrapping in
// quotes. A name like `Foo"Bar` would otherwise break the column alignment of every
// field after it; a name like `=HYPERLINK(...)` would execute as a formula/link the
// moment this CSV is opened in Excel/Sheets.
function csvField(value: unknown): string {
  let s = String(value ?? '');
  // OWASP's standard CSV-injection mitigation: a leading =, +, -, @ (or tab/CR,
  // which some spreadsheet apps also treat as a formula prefix) gets a leading
  // single quote - shown as literal text, no visible artifact, formula never runs.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  // CSV spec: a literal " inside a quoted field is written as two double quotes.
  s = s.replace(/"/g, '""');
  return `"${s}"`;
}

// Shared by CierreCajaModal (live, mid-close) and ResumenTab (re-download any time
// after a day is already closed - decisions then come from the persisted
// DailyClose.decisions column via GET /dashboard, not local component state).
export function downloadCierreCSV(fecha: string, orders: any[], decisions: Record<string, string>) {
  const header = ['#', 'Cliente', 'Teléfono', 'Dirección', 'Productos', 'Total', 'Pago', 'Estado', 'Acción cierre'].join(',');
  const rows = orders.map((o) => {
    const total = o.items.reduce((s: number, i: any) => s + Number(i.price), 0);
    const productos = o.items.map((i: any) => `${i.quantity_label ? i.quantity_label + ' ' : ''}${i.product_name}`).join(' | ');
    const accion = o.paid || o.status === 'cerrado'
      ? 'Completado'
      : (DECISION_LABEL[decisions[o.id] ?? ''] ?? 'Sin decidir');
    return [
      csvField(o.num),
      csvField(o.customer_name),
      csvField(o.customer_phone ?? ''),
      csvField(o.address),
      csvField(productos),
      csvField(total),
      csvField(PAYMENT_LABEL[o.payment_method] ?? o.payment_method),
      csvField(STATUS_LABEL[o.status] ?? o.status),
      csvField(accion),
    ].join(',');
  });
  const csv = [header, ...rows].join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Cierre_${fecha}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
