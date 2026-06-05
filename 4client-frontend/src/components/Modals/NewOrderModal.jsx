import React from 'react';

function NewOrderModal({ onClose }) {
  return (
    <div className="moverlay on" id="m-nuevo">
      <div className="mwin" style={{ maxWidth: '900px', width: '95%' }}>
        <div className="mhead">
          <div className="mtit">Registrar nuevo pedido</div>
          <button className="mclose" onClick={onClose}>×</button>
        </div>
        <div className="mbody" style={{ display: 'flex', flexWrap: 'wrap', gap: '20px', alignItems: 'flex-start' }}>
          
          <div style={{ flex: '2', minWidth: '320px' }}>
            <div className="frow">
              <div className="fg2">
                <label className="fl2">Canal</label>
                <select className="fi2" id="np-canal"><option>📱 WhatsApp</option><option>📞 Llamada</option></select>
              </div>
              <div className="fg2">
                <label className="fl2">Método de pago</label>
                <select className="fi2" id="np-pago">
                  <option value="casa">💵 Cobra en casa</option>
                  <option value="transferencia">📲 Transferencia</option>
                  <option value="efectivo">💳 Pagado en tienda</option>
                </select>
              </div>
            </div>
            
            <div className="frow">
              <div className="fg2">
                <label className="fl2">Nombre del cliente *</label>
                <input className="fi2" id="np-nom" placeholder="Ej: María González" />
              </div>
              <div className="fg2">
                <label className="fl2">Teléfono</label>
                <input className="fi2" id="np-tel" placeholder="Ej: 3001234567" />
              </div>
            </div>
            
            <div className="fg2">
              <label className="fl2">Dirección de entrega *</label>
              <input className="fi2" id="np-dir" placeholder="Ej: Cra 45 #12-34, Casa azul" />
            </div>
            
            <div className="fg2">
              <label className="fl2">Domiciliario</label>
              <select className="fi2" id="np-dom">
                <option value="">— Sin asignar —</option>
                <option value="Pedro Gómez">🛵 Pedro Gómez</option>
                <option value="Andrés Castillo">🛵 Andrés Castillo</option>
              </select>
            </div>
            
            <div className="stit">Productos</div>
            <div className="psearch">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--gt)" strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input id="np-ps" type="text" placeholder="Buscar producto..." />
            </div>
            
            <div className="ilist" id="np-il">
              <div className="irow hdr"><div>Producto</div><div>Cantidad</div><div>Precio</div><div></div></div>
              <div style={{ padding: '20px', textAlign: 'center', color: 'var(--gt)', fontSize: '13px' }}>Aún no hay productos</div>
            </div>
            
            <div className="factbox">
              <div style={{ fontSize: '12px', fontWeight: '800', color: 'var(--gt)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: '9px' }}>Resumen</div>
              <div className="facttot"><span>Total</span><span id="np-tot">$0</span></div>
            </div>
            
            <div className="mactions">
              <button className="bsec" onClick={onClose}>Cancelar</button>
              <button className="bpri" onClick={onClose}>✓ Registrar pedido</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default NewOrderModal;
