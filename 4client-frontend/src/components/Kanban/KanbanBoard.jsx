import React, { useState, useEffect } from 'react';
import { ESTADOS, EL, COL_COLORS, pedidos as initialPedidos, tickets as initialTickets } from '../../data/mockData';
import OrderCard from './OrderCard';
import TicketModal from '../Modals/TicketModal';
import OrderDetailModal from '../Modals/OrderDetailModal';

function KanbanBoard({ user }) {
  const [pedidos, setPedidos] = useState(initialPedidos);
  const [tickets, setTickets] = useState(initialTickets);
  const [search, setSearch] = useState('');
  const [payFilter, setPayFilter] = useState('');
  
  const [activeTicket, setActiveTicket] = useState(null);
  const [activePedido, setActivePedido] = useState(null);

  // Setup current date logic for demo
  const [currentDateStr, setCurrentDateStr] = useState('');
  
  useEffect(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    const today = d.toISOString().split('T')[0];
    setCurrentDateStr(today);
    
    const pd = [...initialPedidos];
    pd.forEach(p => p.fecha = today);
    setPedidos(pd);
    
    const tk = [...initialTickets];
    tk.forEach(t => t.fecha = today);
    setTickets(tk);
  }, []);

  const getFilteredPedidos = () => {
    return pedidos.filter(p => p.fecha === currentDateStr);
  };

  const visibleTickets = tickets.filter(t => t.fecha === currentDateStr).filter(t => {
    if (search) {
      const q = search.toLowerCase();
      if (!t.name.toLowerCase().includes(q) && !t.phone.includes(q)) return false;
    }
    if (payFilter) {
      const tPeds = t.pedidoIds.map(id => pedidos.find(p => p.id === id)).filter(p => p && p.estado !== 'papelera');
      if (!tPeds.some(p => p.pago === payFilter)) return false;
    }
    return true;
  });

  const onDragStart = (e, pid, tid) => {
    e.dataTransfer.setData('pid', pid);
    e.dataTransfer.setData('tid', tid);
  };

  const onDrop = (e, tid, estado) => {
    e.preventDefault();
    const pid = e.dataTransfer.getData('pid');
    const sourceTid = e.dataTransfer.getData('tid');
    
    if (sourceTid !== tid) {
      alert("Solo puedes arrastrar el pedido dentro de la misma fila del cliente.");
      return;
    }
    
    const pedIndex = pedidos.findIndex(p => p.id === pid);
    if (pedIndex > -1) {
      const p = pedidos[pedIndex];
      if (p.pagado || p.cajaCerrada) return; 
      if (p.estado === estado) return; 
      
      const newPedidos = [...pedidos];
      newPedidos[pedIndex] = { ...p, estado: estado };
      setPedidos(newPedidos);
    }
  };

  const onDragOver = (e) => {
    e.preventDefault();
    e.currentTarget.style.background = '#F0FAF4';
  };

  const onDragLeave = (e) => {
    e.currentTarget.style.background = '';
  };

  return (
    <>
      <div className="khead">
        <div>
          <div className="ktit">Tickets & Pedidos de despacho</div>
          <div className="kmeta" id="panel-meta">Cargando...</div>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="date" className="fsel" style={{ cursor: 'pointer' }} value={currentDateStr} onChange={(e) => setCurrentDateStr(e.target.value)} />
          <div className="sbx" style={{ minWidth: '170px' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="text" placeholder="Buscar..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="fsel" value={payFilter} onChange={(e) => setPayFilter(e.target.value)}>
            <option value="">Todos los pagos</option>
            <option value="efectivo">Efectivo</option>
            <option value="transferencia">Transferencia</option>
            <option value="casa">Cobra en casa</option>
          </select>
          <button className="bnew">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Nuevo pedido
          </button>
        </div>
      </div>

      <div className="slane-wrap" id="swimlane">
        <div className="slane">
          {/* Header row equivalent */}
          <div className="slane-hcell wpp-col">💬 Tickets WPP</div>
          {ESTADOS.map((e) => (
            <div key={e} className="slane-hcell" style={{ borderTop: `3px solid ${COL_COLORS[e]}` }}>{EL[e]}</div>
          ))}

          {/* Rows equivalent */}
          {visibleTickets.map(t => {
            const tPeds = t.pedidoIds.map(id => pedidos.find(p => p.id === id)).filter(p => p && p.estado !== 'papelera');
            if (tPeds.length === 0) return null; 
            
            return (
              <React.Fragment key={t.id}>
                {/* Ticket Info Cell */}
                <div className="slane-tcell" onClick={() => setActiveTicket(t)}>
                  <div style={{fontWeight: 800, color: 'var(--vd)', fontSize: '14px', marginBottom: '4px'}}>{t.name}</div>
                  <div style={{fontSize: '12px', color: 'var(--gt)', marginBottom: '8px'}}>{t.phone}</div>
                  <div style={{fontSize: '11px', fontWeight: 600, color: 'var(--v)'}}>Abrir chat ›</div>
                </div>

                {/* Status Column Cells */}
                {ESTADOS.map(estado => {
                  const inState = tPeds.filter(p => p.estado === estado);
                  return (
                    <div 
                      key={estado} 
                      className="slane-scell" 
                      style={{ alignItems: 'flex-start', justifyContent: 'flex-start', flexDirection: 'column', gap: '7px', display: 'flex' }}
                      onDragOver={onDragOver}
                      onDragLeave={onDragLeave}
                      onDrop={(e) => { onDragLeave(e); onDrop(e, t.id, estado); }}
                    >
                      {inState.map(ped => (
                        <OrderCard 
                          key={ped.id} 
                          pedido={ped} 
                          ticket={t} 
                          color={COL_COLORS[estado]} 
                          onDragStart={onDragStart} 
                          onViewDetail={setActivePedido}
                        />
                      ))}
                    </div>
                  );
                })}
              </React.Fragment>
            );
          })}
        </div>
        
        {visibleTickets.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--gt)', fontSize: '15px' }}>
            No hay tickets con esta combinación.
          </div>
        )}
      </div>
      
      <TicketModal ticket={activeTicket} onClose={() => setActiveTicket(null)} />
      <OrderDetailModal pedido={activePedido} onClose={() => setActivePedido(null)} />
    </>
  );
}

export default KanbanBoard;
