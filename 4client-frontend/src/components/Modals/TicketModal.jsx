import React from 'react';
import { EL, pedidos as allPedidos } from '../../data/mockData';

function TicketModal({ ticket, onClose, onCreateOrder }) {
  if (!ticket) return null;

  return (
    <div className="moverlay on" id="m-ticket">
      <div className="mwin">
        <div className="mhead">
          <div>
            <div className="mtit" id="tk-tit">Conversación con {ticket.name}</div>
            <div className="msub" id="tk-sub">{ticket.phone} · Ticket WPP</div>
          </div>
          <button className="mclose" onClick={onClose}>×</button>
        </div>
        <div className="mbody">
          <div style={{ background: 'var(--bg)', borderRadius: 'var(--rad)', padding: '8px 12px', marginBottom: '12px', fontSize: '12px', color: 'var(--gt)', fontWeight: '600' }}>
            🔒 Este es el registro inmutable de la conversación de WhatsApp. No se puede modificar.
          </div>
          <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
            <div style={{ flex: '2', minWidth: '300px', display: 'flex', flexDirection: 'column', maxHeight: '600px' }}>
              <div className="chat-outer" id="tk-chat" style={{ flex: '1', overflowY: 'auto' }}>
                <div className="chat-sep">Hoy</div>
                {ticket.msgs.map((m, i) => (
                  <div key={i} className={`chat-msg ${m.from === 'c' ? 'them' : 'us'}`}>
                    <div className="chat-bubble">{m.text}</div>
                    <div className="chat-meta">{m.from === 'c' ? ticket.name : 'Encargado'} · {m.t}</div>
                  </div>
                ))}
              </div>
            </div>

            <div id="tk-ped-info" style={{ flex: '1', minWidth: '280px', position: 'sticky', top: '0', maxHeight: '600px', overflowY: 'auto' }}>
              {ticket.pedidoIds && ticket.pedidoIds.length > 0 && (() => {
                const peds = ticket.pedidoIds.map(id => allPedidos.find(p => p.id === id)).filter(p => p && p.estado !== 'papelera');
                if (peds.length === 0) return null;
                
                return (
                  <>
                    <div style={{ marginTop: '0', fontSize: '13px', fontWeight: '800', color: 'var(--gt)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '1px' }}>
                      Pedidos de este chat
                    </div>
                    {peds.map(ped => (
                      <div key={ped.id} style={{ background: '#fff', borderRadius: '10px', padding: '12px', marginBottom: '12px', border: '1px solid var(--brd)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                          <strong>Pedido #{ped.num}</strong>
                          <span style={{ background: 'var(--vc)', color: 'var(--vd)', padding: '2px 8px', borderRadius: '20px', fontSize: '11px', fontWeight: '800' }}>
                            {EL[ped.estado]}
                          </span>
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--gt)' }}>
                          {ped.items.map(i => `${i.q} ${i.n}`).join(', ')}
                        </div>
                      </div>
                    ))}
                  </>
                );
              })()}
            </div>
          </div>
          
          <div className="mactions" id="tk-actions">
            <button className="bsec" onClick={onClose}>Cerrar vista</button>
            <button className="bpri" onClick={() => onCreateOrder && onCreateOrder(ticket)}>
              ➕ Crear pedido de este chat
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default TicketModal;
