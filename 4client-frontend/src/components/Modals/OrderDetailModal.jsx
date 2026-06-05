import React from 'react';
import { EL } from '../../data/mockData';

function OrderDetailModal({ pedido, onClose }) {
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
        <div className="mbody">
          <div style={{ background: 'var(--vc)', borderRadius: 'var(--rad)', padding: '12px 16px', marginBottom: '16px' }} id="det-info">
            <strong>{pedido.cli}</strong><br />
            {pedido.tel} <br />
            {pedido.dir}
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
          
          <div className="mactions" id="det-actions">
            <button className="bsec" onClick={onClose}>Cancelar</button>
            <button className="bpri" onClick={onClose}>Guardar Cambios</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default OrderDetailModal;
