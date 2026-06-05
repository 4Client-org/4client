import React from 'react';
import { EL } from '../../data/mockData';

function OrderDetailModal({ pedido, ticket, onClose, onMove }) {
  if (!pedido) return null;

  const total = pedido.items.reduce((s, i) => s + (parseInt(i.p) || 0), 0);
  const fmt = (n) => '$' + (n || 0).toLocaleString('es-CO');

  return (
    <div className="moverlay on" id="m-det">
      <div className="mwin">
        <div className="mhead">
          <div>
            <div className="mtit" id="det-tit">Pedido #{pedido.num}</div>
            <div className="msub" id="det-sub">Estado actual: {EL[pedido.estado]}</div>
          </div>
          <button className="mclose" onClick={onClose}>×</button>
        </div>
        <div className="mbody" style={{ display: 'flex', flexWrap: 'wrap', gap: '20px', alignItems: 'flex-start' }}>
          
          {ticket && (
            <div id="det-chat-wrap" style={{ flex: '1', minWidth: '280px' }}>
              <div style={{ background: '#ECE5DD', borderRadius: '10px', padding: '10px', maxHeight: '600px', overflowY: 'auto', border: '2px solid var(--v)' }}>
                <div style={{ fontSize: '11px', color: '#667781', marginBottom: '6px', fontWeight: 'bold', textAlign: 'center' }}>💬 Conversación de WhatsApp</div>
                {ticket.msgs.map((m, i) => (
                  <div key={i} className={`chat-msg ${m.from === 'c' ? 'them' : 'us'}`} style={{ marginBottom: '5px', maxWidth: '95%' }}>
                    <div className="chat-bubble" style={{ padding: '6px 10px', fontSize: '12px', display: 'inline-block' }}>{m.text}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ flex: '2', minWidth: '320px' }}>
            <div style={{ background: 'var(--vc)', borderRadius: 'var(--rad)', padding: '12px 16px', marginBottom: '16px' }} id="det-info">
            <strong>{pedido.cli}</strong><br />
            {pedido.tel} <br />
            {pedido.dir}
          </div>
          
          <div className="stit">Mover pedido</div>
          <div className="movbtns" id="det-mover" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
            {['nuevo', 'preparando', 'listo', 'camino', 'entregado'].map(e => (
              <button 
                key={e} 
                className={`mbtn ${pedido.estado === e ? 'cur' : ''}`}
                style={pedido.estado === e ? { background: 'var(--v)', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: '20px', cursor: 'default' } : { background: 'var(--b)', border: '1px solid var(--brd)', padding: '6px 12px', borderRadius: '20px', cursor: 'pointer' }}
                onClick={() => onMove && onMove(pedido.id, e)}
              >
                {EL[e]}
              </button>
            ))}
          </div>
          
          <div className="stit">Información del pedido</div>
          <div className="frow">
            <div className="fg2">
              <label className="fl2">Nombre del cliente</label>
              <input className="fi2" id="det-nom" defaultValue={pedido.cli} />
            </div>
            <div className="fg2">
              <label className="fl2">Teléfono</label>
              <input className="fi2" id="det-tel" defaultValue={pedido.tel} />
            </div>
          </div>
          <div className="fg2">
            <label className="fl2">Dirección</label>
            <input className="fi2" id="det-dir" defaultValue={pedido.dir} />
          </div>
          
          <div className="frow">
            <div className="fg2">
              <label className="fl2">Método de pago</label>
              <select className="fi2" id="det-pago" defaultValue={pedido.pago}>
                <option value="casa">💵 Cobra en casa</option>
                <option value="transferencia">📲 Transferencia</option>
                <option value="efectivo">💳 Pagado en tienda</option>
              </select>
            </div>
            <div className="fg2">
              <label className="fl2">Domiciliario</label>
              <select className="fi2" id="det-dom" defaultValue={pedido.domiciliario || ''}>
                <option value="">— Sin asignar —</option>
                <option value="Pedro Gómez">🛵 Pedro Gómez</option>
                <option value="Andrés Castillo">🛵 Andrés Castillo</option>
              </select>
            </div>
          </div>
          
          <div className="stit">Productos</div>
          <div className="ilist" id="det-il">
            <div className="irow hdr">
              <div>Producto</div>
              <div>Cantidad</div>
              <div>Precio</div>
              <div></div>
            </div>
            {pedido.items.map((it, idx) => (
              <div key={idx} className="irow">
                <div>{it.n}</div>
                <div>{it.q}</div>
                <div>{fmt(parseInt(it.p))}</div>
                <div></div>
              </div>
            ))}
          </div>
          
          <div className="factbox" style={{ marginTop: '12px' }}>
            <div style={{ fontSize: '12px', fontWeight: '800', color: 'var(--gt)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: '9px' }}>Factura</div>
            <div className="facttot"><span>Total</span><span id="det-tot">{fmt(total)}</span></div>
          </div>
          
          <div id="det-hist-wrap" style={{ marginTop: '16px', border: '1px solid var(--brd)', borderRadius: 'var(--rad)', background: 'var(--bg)' }}>
            <div 
              className="hist-toggle" 
              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 16px', fontSize: '14px', fontWeight: '600', color: 'var(--txt)', cursor: 'pointer', background: 'transparent' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
              Historial de movimientos y cambios
              <span style={{ background: 'var(--v)', color: '#fff', borderRadius: '20px', padding: '1px 7px', fontSize: '11px', fontWeight: '800', marginLeft: 'auto' }}>
                {pedido.hist ? pedido.hist.length : 0}
              </span>
            </div>
            <div className="hist-body" style={{ padding: '0 16px 16px 16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {pedido.hist && pedido.hist.map((h, i) => (
                <div key={i} style={{ display: 'flex', gap: '10px' }}>
                  <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--az)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 'bold' }}>
                    {h.who[0].toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: '600' }}>{h.what}</div>
                    <div style={{ fontSize: '12px', color: 'var(--gt)' }}>Por {h.who} a las {h.t}</div>
                  </div>
                </div>
              ))}
              {(!pedido.hist || pedido.hist.length === 0) && (
                <div style={{ fontSize: '12px', color: 'var(--gt)' }}>No hay movimientos registrados.</div>
              )}
            </div>
          </div>
          
          <div className="mactions" id="det-actions" style={{ marginTop: '16px' }}>
            <button className="bsec" onClick={onClose}>Cancelar</button>
            <button className="bpri" onClick={onClose}>Guardar Cambios</button>
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default OrderDetailModal;
