import jsPDF from 'jspdf';

// Factura de la PLATAFORMA (4Client) a una organización cliente - distinto del
// PDF de factura de un pedido (DetallePedidoModal.tsx, formato angosto de
// recibo térmico 80mm). Este es un documento normal tamaño carta, para que
// Jose lo guarde/envíe como comprobante de cobro real, no un tiquete de caja.
const TYPE_LABEL: Record<string, string> = {
  suscripcion: 'Suscripción mensual',
  onboarding: 'Onboarding / puesta en marcha',
  otro: 'Otro',
};

export interface ChargeForPdf {
  orgName: string;
  type: string;
  period?: string | null;
  amount: number;
  due_date: string;
  notes?: string | null;
}

export function buildPlatformChargePdf(charge: ChargeForPdf): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'letter' });
  doc.setFont('helvetica');

  let y = 25;
  doc.setFontSize(18); doc.setFont('helvetica', 'bold');
  doc.text('4Client', 20, y); y += 8;
  doc.setFontSize(11); doc.setFont('helvetica', 'normal');
  doc.text('Comprobante de cobro', 20, y); y += 12;

  doc.setDrawColor(200); doc.line(20, y, 190, y); y += 10;

  doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.text('Cliente:', 20, y);
  doc.setFont('helvetica', 'normal'); doc.text(charge.orgName, 55, y); y += 7;

  doc.setFont('helvetica', 'bold'); doc.text('Concepto:', 20, y);
  doc.setFont('helvetica', 'normal'); doc.text(TYPE_LABEL[charge.type] ?? charge.type, 55, y); y += 7;

  if (charge.period) {
    doc.setFont('helvetica', 'bold'); doc.text('Período:', 20, y);
    doc.setFont('helvetica', 'normal'); doc.text(charge.period, 55, y); y += 7;
  }

  doc.setFont('helvetica', 'bold'); doc.text('Vencimiento:', 20, y);
  doc.setFont('helvetica', 'normal'); doc.text(charge.due_date, 55, y); y += 7;

  if (charge.notes) {
    doc.setFont('helvetica', 'bold'); doc.text('Notas:', 20, y);
    doc.setFont('helvetica', 'normal');
    const lines = doc.splitTextToSize(charge.notes, 115);
    doc.text(lines, 55, y); y += lines.length * 5 + 2;
  }

  y += 8;
  doc.line(20, y, 190, y); y += 12;
  doc.setFontSize(14); doc.setFont('helvetica', 'bold');
  doc.text('Valor:', 20, y);
  doc.text(`$${charge.amount.toLocaleString('es-CO')}`, 190, y, { align: 'right' });

  return doc;
}

// jsPDF's own output('datauristring') incluye el prefijo "data:...;base64," -
// el backend (routes/dev.ts's POST /dev/charges) solo quiere el base64 puro,
// mismo criterio que canvasToBase64Png (lib/catalogImage.ts) para el catálogo.
export function pdfToBase64(doc: jsPDF): string {
  const dataUri = doc.output('datauristring');
  return dataUri.split(',')[1] ?? '';
}
