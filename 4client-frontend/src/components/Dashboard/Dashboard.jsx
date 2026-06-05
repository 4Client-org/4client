import { useState } from 'react';
import KanbanBoard from '../Kanban/KanbanBoard';

function Dashboard({ user, onLogout }) {
  const [activeTab, setActiveTab] = useState('swimlane');

  return (
    <div id="s-admin" className="scr on">
      <div className="al">
        <header className="ah">
          <div className="ht">
            <div className="hlogo">
              <img src="/mnt/user-data/uploads/4Client-Logo.png" style={{ width: '34px', height: '34px', objectFit: 'contain' }} alt="4Client" onError={(e) => e.target.style.display='none'} />
              <span className="hlogo-t">4Client</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
              <div className="huser">
                <div className={`uav ${user.admin ? 'adm' : ''}`} id="h-av">{user.label[0].toUpperCase()}</div>
                <div>
                  <div className="un" id="h-un">{user.label}</div>
                  <div className="ur2" id="h-rol">{user.role}</div>
                </div>
              </div>
              {user.admin && (
                <button className="bnew" id="btn-cierre" style={{ background: 'var(--az)', padding: '8px 14px', fontSize: '13px' }}>
                  🏦 Cierre de caja
                </button>
              )}
              <button className="bout" onClick={onLogout}>Salir</button>
            </div>
          </div>
          <div className="tabs">
            <button className={`tab ${activeTab === 'swimlane' ? 'on' : ''}`} onClick={() => setActiveTab('swimlane')}>📋 Tickets & Pedidos</button>
            {user.admin && (
              <button className={`tab ${activeTab === 'resumen' ? 'on' : ''}`} onClick={() => setActiveTab('resumen')}>📊 Resumen del día</button>
            )}
          </div>
        </header>
        
        <div className="ac">
          {activeTab === 'swimlane' && (
            <div id="adm-swimlane">
              <KanbanBoard user={user} />
            </div>
          )}
          
          {activeTab === 'resumen' && (
             <div id="adm-resumen">
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--gt)', fontSize: '14px' }}>
                  Dashboard de Resumen en construcción...
                </div>
             </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
