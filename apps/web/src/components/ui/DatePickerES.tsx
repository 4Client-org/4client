import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { todayStr } from '../../lib/format';

interface Props {
  value: string; // YYYY-MM-DD
  onChange: (value: string) => void;
  className?: string;
  // Shown on the trigger button when `value` is empty. Defaults to the original
  // full label - only the inbox search's optional date filter needs something
  // shorter ("Fecha" instead of "Seleccionar fecha") to fit its narrower spot
  // without wrapping to two lines.
  placeholder?: string;
}

const WEEKDAYS = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
const MONTHS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];
const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const WEEKDAY_SHORT = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const POPUP_WIDTH = 260;

function parseYMD(v: string): { y: number; m: number; d: number } {
  const [y, m, d] = v.split('-').map(Number);
  return { y, m, d };
}

function toYMD(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Native <input type="date"> renders its popup calendar via internal browser UI (not
// page DOM) - its "Today"/"Clear" button labels follow the browser's own interface
// language, not the page's `lang` attribute or content, so there is no way to make
// that native picker show Spanish text. This component replaces it with one we fully
// control instead of another attribute that silently doesn't do anything in Chromium.
export default function DatePickerES({ value, onChange, className, placeholder = 'Seleccionar fecha' }: Props) {
  const [open, setOpen] = useState(false);
  const { y, m } = parseYMD(value || todayStr());
  const [viewY, setViewY] = useState(y);
  const [viewM, setViewM] = useState(m); // 1-12
  const btnRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  // Portal a document.body + position:fixed (mismo patrón que CategoryPicker/
  // EnviarCatalogoMenu) - un `position:absolute;left:0` relativo al botón
  // (lo que había antes) manda el calendario fuera de la pantalla apenas el
  // botón no está pegado al borde izquierdo (reportado en celular: en
  // "Informe del día" - apretado entre Cerrar caja/Bloquear todos - y en la
  // barra de búsqueda de Chats WPP). `left` se calcula clamped al ancho de
  // la ventana, nunca fijo en 0.
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const { y: vy, m: vm } = parseYMD(value || todayStr());
    setViewY(vy);
    setViewM(vm);
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    const reposition = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (!r) return;
      const left = Math.min(Math.max(8, r.left), window.innerWidth - POPUP_WIDTH - 8);
      setCoords({ top: r.bottom + 6, left });
    };
    reposition();

    function onDocClick(e: MouseEvent) {
      const target = e.target as Node;
      if (btnRef.current?.contains(target) || popupRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onEsc(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
    // Reposiciona en vez de cerrar en scroll/resize - mismo motivo que
    // CategoryPicker/EnviarCatalogoMenu: abrir con clic enfoca el botón, y el
    // navegador puede hacer scroll-into-view solo, cerrando el popup en el
    // mismo gesto que lo abrió si se cerrara en cualquier scroll.
    function onScrollOrResize() { reposition(); }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open]);

  function shiftMonth(delta: number) {
    let nm = viewM + delta;
    let ny = viewY;
    if (nm < 1) { nm = 12; ny -= 1; }
    if (nm > 12) { nm = 1; ny += 1; }
    setViewM(nm);
    setViewY(ny);
  }

  function pick(day: number) {
    onChange(toYMD(viewY, viewM, day));
    setOpen(false);
  }

  const label = (() => {
    if (!value) return placeholder;
    const { y: vy, m: vm, d: vd } = parseYMD(value);
    const dt = new Date(vy, vm - 1, vd);
    return `${WEEKDAY_SHORT[dt.getDay()]}, ${vd} ${MONTHS_SHORT[vm - 1]} ${vy}`;
  })();

  const firstWeekday = new Date(viewY, viewM - 1, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(viewY, viewM, 0).getDate();
  const cells: (number | null)[] = [...Array(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

  const today = todayStr();

  return (
    <>
      <button ref={btnRef} type="button" className={className ?? 'fsel'} onClick={() => setOpen((o) => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
        <Calendar size={14} />
        {label}
      </button>

      {open && coords && createPortal(
        <div ref={popupRef} style={{
          // Above .ah (200) and the swimlane's sticky bars (zona roja 160, status
          // header 150) - this popup used to render behind all of them once open.
          position: 'fixed', top: coords.top, left: coords.left, zIndex: 250,
          background: 'var(--b)', border: '1px solid var(--brd)', borderRadius: 'var(--rad)',
          boxShadow: 'var(--shf)', padding: 12, width: POPUP_WIDTH,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <button type="button" onClick={() => shiftMonth(-1)} title="Mes anterior"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--n)', display: 'flex', padding: 4 }}>
              <ChevronLeft size={16} />
            </button>
            <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--n)' }}>{MONTHS[viewM - 1]} {viewY}</div>
            <button type="button" onClick={() => shiftMonth(1)} title="Mes siguiente"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--n)', display: 'flex', padding: 4 }}>
              <ChevronRight size={16} />
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 4 }}>
            {WEEKDAYS.map((w, i) => (
              <div key={i} style={{ textAlign: 'center', fontSize: 10, fontWeight: 800, color: 'var(--gt)', padding: '2px 0' }}>{w}</div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
            {cells.map((day, i) => {
              if (day == null) return <div key={i} />;
              const ymd = toYMD(viewY, viewM, day);
              const isSelected = ymd === value;
              const isToday = ymd === today;
              return (
                <button key={i} type="button" onClick={() => pick(day)}
                  style={{
                    aspectRatio: '1', border: 'none', borderRadius: 8, cursor: 'pointer',
                    fontSize: 12, fontWeight: isSelected ? 800 : 600,
                    background: isSelected ? 'var(--v)' : isToday ? 'var(--vc)' : 'transparent',
                    color: isSelected ? '#fff' : isToday ? 'var(--vd)' : 'var(--n)',
                  }}>
                  {day}
                </button>
              );
            })}
          </div>

          <div style={{ display: 'flex', marginTop: 12, borderTop: '1px solid var(--brd)', paddingTop: 10 }}>
            <button type="button" onClick={() => { onChange(today); setOpen(false); }}
              style={{ flex: 1, padding: '7px 0', fontSize: 12, fontWeight: 700, background: 'var(--v)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
              Hoy
            </button>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
