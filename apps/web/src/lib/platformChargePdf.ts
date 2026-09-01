import jsPDF from 'jspdf';

// Factura de la PLATAFORMA (4Client) a una organización cliente - distinto del
// PDF de factura de un pedido (DetallePedidoModal.tsx, formato angosto de
// recibo térmico 80mm). Este es un documento normal tamaño carta, con look de
// factura real (logo, número, fecha de generación, etc.) - Jose lo guarda/
// envía como comprobante de cobro, no un tiquete de caja.
const TYPE_LABEL: Record<string, string> = {
  suscripcion: 'Suscripción mensual',
  onboarding: 'Onboarding / puesta en marcha',
  otro: 'Otro',
};

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function periodLabel(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return `${MESES[(m ?? 1) - 1] ?? period} ${y}`;
}

// Número de comprobante legible - a partir de PlatformCharge.number (columna
// autoincrement real en la BD, ver schema.prisma). Reemplaza al número
// anterior basado en la fecha/hora de generación (nunca chocaba, pero
// tampoco era un consecutivo de verdad) - a pedido explícito del usuario.
function invoiceNumber(number: number): string {
  return `4C-${String(number).padStart(6, '0')}`;
}

function fullDateEs(d: Date): string {
  return `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Carga /logo.png (mismo asset que ya usa el login/manifest de la PWA) y lo
// reduce a un JPEG chico antes de incrustarlo en el PDF - el archivo real
// pesa ~1.1MB (tiene sombras/degradados, comprime mal como PNG) y, sin
// reducir, el PDF resultante salía de ~3.2MB y el backend lo rechazaba con
// 413 (confirmado generando una factura real de prueba). Solo hace falta
// verse bien a los ~46x25mm donde se coloca - se redibuja a una resolución
// chica en un <canvas> y se reexporta como JPEG calidad 0.85, quedando en
// unos pocos KB en vez de más de un megabyte. Cacheado en memoria (module-
// level) para no repetir esto en cada factura generada en la misma sesión.
let cachedLogo: string | null = null;
async function loadLogoDataUrl(): Promise<string | null> {
  if (cachedLogo) return cachedLogo;
  try {
    const res = await fetch('/logo.png');
    if (!res.ok) return null;
    const blob = await res.blob();
    const bitmap = await createImageBitmap(blob);
    const targetW = 400; // de sobra para el tamaño impreso real (~46mm)
    const targetH = Math.round(targetW * (bitmap.height / bitmap.width));
    const canvas = document.createElement('canvas');
    canvas.width = targetW; canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, targetW, targetH);
    cachedLogo = canvas.toDataURL('image/jpeg', 0.85);
    return cachedLogo;
  } catch {
    return null; // sin logo no se bloquea la factura - se genera igual sin él
  }
}

export interface ChargeForPdf {
  number: number;
  orgName: string;
  types: string[];
  period: string;
  amount: number;
  notes?: string | null;
}

const GREEN = '#1A7A4A';
const GREEN_DARK = '#0F4F30';
const GRAY = '#6B7280';

export async function buildPlatformChargePdf(charge: ChargeForPdf): Promise<jsPDF> {
  const doc = new jsPDF({ unit: 'mm', format: 'letter' });
  doc.setFont('helvetica');
  const now = new Date();
  const PAGE_W = 216; // carta, mm

  // ── Encabezado: logo a la izquierda, número + fecha de generación a la derecha ──
  const logo = await loadLogoDataUrl();
  if (logo) {
    // Aspect ratio real del archivo (1408x768) - mantenerlo para que no se
    // vea estirado/aplastado.
    doc.addImage(logo, 'JPEG', 20, 14, 46, 25.1);
  } else {
    doc.setFontSize(16); doc.setFont('helvetica', 'bold'); doc.setTextColor(GREEN_DARK);
    doc.text('4Client', 20, 26);
  }

  doc.setTextColor(GRAY);
  doc.setFontSize(9); doc.setFont('helvetica', 'normal');
  doc.text('Comprobante de cobro', PAGE_W - 20, 18, { align: 'right' });
  doc.setFont('helvetica', 'bold'); doc.setTextColor(GREEN_DARK);
  doc.setFontSize(11);
  doc.text(`No. ${invoiceNumber(charge.number)}`, PAGE_W - 20, 24, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setTextColor(GRAY); doc.setFontSize(9);
  doc.text(`Generado el ${fullDateEs(now)}`, PAGE_W - 20, 29, { align: 'right' });

  let y = 46;
  doc.setDrawColor(GREEN); doc.setLineWidth(0.6);
  doc.line(20, y, PAGE_W - 20, y); y += 12;

  // ── Facturar a ──
  doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(GRAY);
  doc.text('FACTURAR A', 20, y); y += 6;
  doc.setFontSize(13); doc.setFont('helvetica', 'bold'); doc.setTextColor(GREEN_DARK);
  doc.text(charge.orgName, 20, y); y += 12;

  // ── Tabla de conceptos ──
  doc.setFillColor(GREEN);
  doc.rect(20, y, PAGE_W - 40, 8, 'F');
  doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor('#FFFFFF');
  doc.text('CONCEPTO', 24, y + 5.5);
  doc.text('PERÍODO', PAGE_W - 70, y + 5.5);
  y += 8;

  doc.setFont('helvetica', 'normal'); doc.setTextColor('#111827');
  for (const t of charge.types) {
    doc.setFillColor('#F9FAFB');
    doc.rect(20, y, PAGE_W - 40, 9, 'F');
    doc.setFontSize(10);
    doc.text(TYPE_LABEL[t] ?? t, 24, y + 6);
    doc.text(periodLabel(charge.period), PAGE_W - 70, y + 6);
    y += 9;
  }
  doc.setDrawColor('#E5E7EB'); doc.setLineWidth(0.3);
  doc.line(20, y, PAGE_W - 20, y);
  y += 10;

  if (charge.notes) {
    doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(GRAY);
    doc.text('NOTAS', 20, y); y += 5;
    doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.setTextColor('#111827');
    const lines = doc.splitTextToSize(charge.notes, PAGE_W - 40);
    doc.text(lines, 20, y); y += lines.length * 5 + 6;
  }

  // ── Total ──
  y += 6;
  doc.setFillColor(GREEN_DARK);
  doc.rect(20, y, PAGE_W - 40, 16, 'F');
  doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor('#FFFFFF');
  doc.text('VALOR TOTAL', 26, y + 10.5);
  doc.setFontSize(15);
  doc.text(`$${charge.amount.toLocaleString('es-CO')}`, PAGE_W - 26, y + 11, { align: 'right' });

  // ── Pie de página ──
  const footerY = 265;
  doc.setDrawColor('#E5E7EB'); doc.setLineWidth(0.3);
  doc.line(20, footerY, PAGE_W - 20, footerY);
  doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(GRAY);
  doc.text('4Client - Sistema de Gestión Operativa', 20, footerY + 6);
  doc.text('Gracias por confiar en 4Client.', PAGE_W - 20, footerY + 6, { align: 'right' });

  return doc;
}

// jsPDF's own output('datauristring') incluye el prefijo "data:...;base64," -
// el backend (routes/dev.ts's POST /dev/charges) solo quiere el base64 puro,
// mismo criterio que canvasToBase64Png (lib/catalogImage.ts) para el catálogo.
export function pdfToBase64(doc: jsPDF): string {
  const dataUri = doc.output('datauristring');
  return dataUri.split(',')[1] ?? '';
}
