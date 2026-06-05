import React, { useState } from 'react';
import { pedidos as allPedidos, tickets as allTickets, EL } from '../../data/mockData';
import OrderDetailModal from '../Modals/OrderDetailModal';

function ResumenDia({ currentDateStr, user }) {
  const [activeTab, setActiveTab] = useState('todos');
  const [activePedido, setActivePedido] = useState(null);

  // Filtramos los pedidos del día actual
  // En mockData actualmente no hay fechas, así que los tomamos todos por simplicidad
  const [pedidos, setPedidos] = useState(allPedidos);

  const pedidosValidos = pedidos.filter(p => p.estado !== 'papelera');
  const papelera = pedidos.filter(p => p.estado === 'papelera');
  
  // Calculate stats
  const total = pedidosValidos.length;
  // Entregados = estado 'entregado'
  const entregados = pedidosValidos.filter(p => p.estado === 'entregado').length;
  // Pendientes = no entregado
  const pendientes = total - entregados;
  // Domicilios activos = en estado 'camino'
  const domicilios = pedidosValidos.filter(p => p.estado === 'camino').length;

  // Recaudado
  const pagados = pedidosValidos.filter(p => p.pagado);
  const ef = pagados.reduce((acc, p) => acc + (p.pago === 'efectivo' || p.pago === 'casa' ? p.items.reduce((s, i) => s + (parseInt(i.p) || 0), 0) : 0), 0);
  const tr = pagados.reduce((acc, p) => acc + (p.pago === 'transferencia' ? p.items.reduce((s, i) => s + (parseInt(i.p) || 0), 0) : 0), 0);

  const fmt = (n) => '$' + (n || 0).toLocaleString('es-CO');

  const handleMove = (pid, estado) => {
    const pedIndex = pedidos.findIndex(p => p.id === pid);
    if (pedIndex > -1) {
      const p = pedidos[pedIndex];
      if (p.pagado || p.cajaCerrada) return;
      if (p.estado === estado) return;

      const newPedidos = [...pedidos];
      const timeStr = new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
      const newHist = [...(p.hist || []), {
        who: user ? user.label : 'Dueño',
        what: 'Estado',
        t: timeStr,
        tipo: 'estado',
        antes: EL[p.estado],
        despues: EL[estado]
      }];

      newPedidos[pedIndex] = { ...p, estado: estado, hist: newHist };
      setPedidos(newPedidos);
      setActivePedido(newPedidos[pedIndex]);
    }
  };

  const renderTable = (list) => (
    <div className="htab">
      <div className="hrow hdr">
        <div>N°</div><div>Cliente</div><div>Valor</div><div>Método</div><div>Estado</div>
      </div>
      {list.length === 0 ? (
        <div style={{ padding: '20px', textAlign: 'center', color: 'var(--gt)', fontSize: '14px' }}>No hay pedidos en esta vista.</div>
      ) : (
        list.map(p => {
          const tot = p.items.reduce((s, i) => s + parseInt(i.p), 0);
          return (
            <div key={p.id} className="hrow" style={{ cursor: 'pointer', ...(p.estado === 'nuevo' ? { background: 'var(--rc)' } : {}) }} onClick={() => setActivePedido(p)}>
              <div style={{ fontWeight: '800' }}>#{p.num}</div>
              <div style={{ fontWeight: '600' }}>{p.cli}</div>
              <div style={{ color: 'var(--v)', fontWeight: '600' }}>{fmt(tot)}</div>
              <div>{p.pago === 'transferencia' ? '📲 Transf.' : p.pago === 'casa' ? '💵 Casa' : '💳 Tienda'}</div>
              <div><span style={{ background: 'var(--vc)', color: 'var(--vd)', padding: '2px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: '800' }}>{EL[p.estado]}</span></div>
            </div>
          );
        })
      )}
    </div>
  );

  return (
    <div id="adm-resumen">
      <div className="khead">
        <div>
          <div className="ktit">Resumen del día</div>
          <div className="kmeta">Totales en tiempo real</div>
        </div>
      </div>

      <div className="agrid">
        <div className="acard"><div className="ai">📋</div><div className="av">{total}</div><div className="al2">Pedidos totales</div></div>
        <div className="acard v"><div className="ai">✅</div><div className="av">{entregados}</div><div className="al2">Entregados</div></div>
        <div className="acard r"><div className="ai">⏳</div><div className="av">{pendientes}</div><div className="al2">Pendientes</div></div>
        <div className="acard az"><div className="ai">🛵</div><div className="av">{domicilios}</div><div className="al2">Domicilios activos</div></div>
      </div>

      <div className="drow">
        <div className="dcard2 v"><div className="dico v">💵</div><div><div className="dlbl">Recaudado efectivo</div><div className="dval">{fmt(ef)}</div></div></div>
        <div className="dcard2 az"><div className="dico az">📲</div><div><div className="dlbl">Recaudado transferencia</div><div className="dval">{fmt(tr)}</div></div></div>
        <div className="dcard2 tot"><div className="dico n">💰</div><div><div className="dlbl">Total recaudado</div><div className="dval">{fmt(ef + tr)}</div></div></div>
      </div>

      <div className="atabs">
        <button className={`atab ${activeTab === 'todos' ? 'on' : ''}`} onClick={() => setActiveTab('todos')}>📋 Todos los pedidos</button>
        <button className={`atab ${activeTab === 'papelera' ? 'on' : ''}`} onClick={() => setActiveTab('papelera')}>🗑 Papelera <span>({papelera.length})</span></button>
      </div>

      <div style={{ background: '#fff', borderRadius: 'var(--rad)', border: '1px solid var(--brd)', padding: '16px' }}>
        {activeTab === 'todos' && renderTable(pedidosValidos)}
        {activeTab === 'papelera' && renderTable(papelera)}
      </div>

      <OrderDetailModal 
        pedido={activePedido} 
        ticket={activePedido ? allTickets.find(t => t.pedidoIds.includes(activePedido.id)) : null}
        onClose={() => setActivePedido(null)} 
        onMove={handleMove}
      />
    </div>
  );
}

export default ResumenDia;
