import React from 'react';

function OrderCard({ pedido, ticket, color, onDragStart }) {
  const tot = pedido.items.reduce((s, i) => s + (parseInt(i.p) || 0), 0);
  const locked = pedido.pagado === true || pedido.cajaCerrada === true;
  
  // calculate minutes waiting for urgency
  const getMins = (h) => {
    const [hh, mm] = h.split(':').map(Number);
    const n = new Date();
    return Math.max(0, (n.getHours() * 60 + n.getMinutes()) - (hh * 60 + mm));
  };
  
  const pedUrg = pedido.estado === 'nuevo' && getMins(pedido.hora) > 20;

  return (
    <div className="dc-wrap" style={pedido.cajaCerrada ? { filter: 'grayscale(1)', opacity: '0.65' } : {}}>
      <div 
        className={`dc-card${pedUrg ? ' urg' : ''}`} 
        style={{ borderLeftColor: pedUrg ? 'var(--r)' : color }}
        draggable={!locked}
        onDragStart={(e) => {
          if (!locked) onDragStart(e, pedido.id, ticket.id);
        }}
      >
        <div className="dc-num">
          #{pedido.num}
          {locked && ' 🔒'}
          {pedUrg && !locked && <span style={{ color: 'var(--r)', fontSize: '11px' }}> ⚠{getMins(pedido.hora)}min</span>}
        </div>
        
        <div className="dc-prod">
          {pedido.items.slice(0, 2).map(i => i.n + (i.q ? ' ' + i.q : '')).join(', ')}
          {pedido.items.length > 2 && ` +${pedido.items.length - 2} más`}
        </div>
        
        {tot > 0 && <div className="dc-tot">${tot.toLocaleString('es-CO')}</div>}
        
        <div className="dc-nav">
          <button className="dc-btn" title="Retroceder" disabled={locked}>‹</button>
          <button className="dc-det-btn">Ver detalle</button>
          <button className="dc-btn" title="Avanzar" disabled={locked}>›</button>
        </div>
      </div>
    </div>
  );
}

export default OrderCard;
