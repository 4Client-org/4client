// ══════════════════════ DATA ══════════════════════
const PRODS=[
  {n:'Papa Pastusa',c:'Tubérculos'},{n:'Papa Criolla',c:'Tubérculos'},
  {n:'Tomate Chonto',c:'Verduras'},{n:'Cebolla Cabezona',c:'Verduras'},
  {n:'Cebolla Larga',c:'Verduras'},{n:'Zanahoria',c:'Verduras'},
  {n:'Cilantro',c:'Hierbas'},{n:'Espinaca',c:'Hojas'},
  {n:'Plátano Hartón',c:'Frutas'},{n:'Mango Tommy',c:'Frutas'},
  {n:'Naranja Valencia',c:'Frutas'},{n:'Limón Tahití',c:'Frutas'},
  {n:'Aguacate Hass',c:'Frutas'},{n:'Yuca',c:'Tubérculos'},
  {n:'Mora',c:'Frutas'},{n:'Lulo',c:'Frutas'},
  {n:'Arepa Blanca Paq.',c:'Empacados'},{n:'Huevos x30',c:'Empacados'},
  {n:'Panela',c:'Empacados'},{n:'Arroz 500g',c:'Granos'},
];
const ESTADOS=['nuevo','preparando','listo','camino','entregado','cerrado'];
const EL={nuevo:'Nuevo',preparando:'Preparando',listo:'Listo',camino:'En camino',entregado:'Entregado',cerrado:'Cerrado'};
const COL_COLORS={nuevo:'#94A3B8',preparando:'#F59E0B',listo:'#3B82F6',camino:'#8B5CF6',entregado:'#1A7A4A',cerrado:'#0F4F30'};
const EC={nuevo:'col-nuevo',preparando:'col-prep',listo:'col-listo',camino:'col-camino',entregado:'col-entregado',cerrado:'col-cerrado'};

let pedidos=[
  {id:'p1',num:'001',cli:'Rosario Díaz',tel:'3011234501',dir:'Cra 52 #18-40, Casa 3, timbre azul',canal:'wpp',pago:'casa',estado:'camino',dom:'Pedro Gómez',hora:'07:20',pagado:false,reg:'encargado1',items:[{n:'Cebolla Cabezona',q:'1 kg',p:4500},{n:'Tomate Chonto',q:'1 kg',p:3800},{n:'Papa Pastusa',q:'2 kg',p:5000},{n:'Cilantro',q:'1 manojo',p:2000}],hist:[{who:'encargado1',what:'Pedido creado',t:'07:20',tipo:'create'},{who:'encargado1',what:'Estado',t:'07:45',tipo:'estado',antes:'Nuevo',despues:'En camino'}]},
  {id:'p2',num:'002',cli:'Fermín Vargas',tel:'3021234502',dir:'Cll 34 #90-12, Apto 204',canal:'wpp',pago:'transferencia',estado:'camino',dom:'Andrés Castillo',hora:'07:35',pagado:false,reg:'encargado1',items:[{n:'Aguacate Hass',q:'3 und',p:9000},{n:'Limón Tahití',q:'6 und',p:3000}],hist:[{who:'encargado1',what:'Pedido creado',t:'07:35',tipo:'create'}]},
  {id:'p3',num:'003',cli:'Jhon Castro',tel:'3031234503',dir:'Av Poblado #15-23, Local 8',canal:'llamada',pago:'efectivo',estado:'listo',dom:'Pedro Gómez',hora:'07:50',pagado:false,reg:'encargado1',items:[{n:'Papa Pastusa',q:'5 kg',p:12500},{n:'Cebolla Cabezona',q:'2 kg',p:9000}],hist:[{who:'encargado1',what:'Pedido creado',t:'07:50',tipo:'create'},{who:'encargado1',what:'Método de pago',t:'08:10',tipo:'edit',antes:'Transferencia',despues:'Efectivo'}]},
  {id:'p4',num:'004',cli:'Patricia Mora',tel:'3041234504',dir:'Cra 43A #14-12, Piso 2',canal:'wpp',pago:'efectivo',estado:'preparando',dom:'',hora:'08:05',pagado:false,reg:'encargado1',items:[{n:'Lulo',q:'2 und',p:5000},{n:'Mora',q:'500g',p:4000}],hist:[{who:'encargado1',what:'Pedido creado',t:'08:05',tipo:'create'}]},
  {id:'p5',num:'005',cli:'Luis Herrera',tel:'3051234505',dir:'Cra 45 #12-10 Apto 302',canal:'wpp',pago:'efectivo',estado:'preparando',dom:'',hora:'08:15',pagado:false,reg:'encargado1',items:[{n:'Zanahoria',q:'1 kg',p:3500},{n:'Espinaca',q:'1 manojo',p:2000}],hist:[{who:'encargado1',what:'Pedido creado',t:'08:15',tipo:'create'},{who:'encargado1',what:'Dirección',t:'08:32',tipo:'edit',antes:'Cra 45 #12-10',despues:'Cra 45 #12-10 Apto 302'}]},
  {id:'p6',num:'006',cli:'Sandra López',tel:'3061234506',dir:'Cll 10 #43-78',canal:'wpp',pago:'transferencia',estado:'listo',dom:'',hora:'08:30',pagado:false,reg:'encargado1',items:[{n:'Mango Tommy',q:'4 und',p:8000},{n:'Naranja Valencia',q:'6 und',p:4500}],hist:[{who:'encargado1',what:'Pedido creado',t:'08:30',tipo:'create'}]},
  {id:'p7',num:'007',cli:'María González',tel:'3071234507',dir:'Cra 80 #30-12',canal:'wpp',pago:'efectivo',estado:'nuevo',dom:'',hora:'08:42',pagado:false,reg:'encargado1',items:[{n:'Papa Pastusa',q:'2 kg',p:5000},{n:'Tomate Chonto',q:'1 kg',p:3800}],hist:[{who:'encargado1',what:'Pedido creado',t:'08:42',tipo:'create'}]},
  {id:'p8',num:'008',cli:'Carlos Ruiz',tel:'3081234508',dir:'Cll 50 #70-24',canal:'llamada',pago:'casa',estado:'nuevo',dom:'',hora:'08:55',pagado:false,reg:'encargado2',items:[{n:'Plátano Hartón',q:'3 und',p:4500},{n:'Yuca',q:'1 kg',p:3000}],hist:[{who:'encargado2',what:'Pedido creado',t:'08:55',tipo:'create'}]},
  {id:'p9',num:'009',cli:'Ana Martínez',tel:'3091234509',dir:'Cra 65 #18-90',canal:'wpp',pago:'transferencia',estado:'nuevo',dom:'',hora:'09:08',pagado:false,reg:'encargado1',items:[{n:'Arepa Blanca Paq.',q:'1 paq',p:4500},{n:'Huevos x30',q:'1 und',p:18000}],hist:[{who:'encargado1',what:'Pedido creado',t:'09:08',tipo:'create'}]},
  {id:'p10',num:'010',cli:'Gloria Reyes',tel:'3101234510',dir:'Cra 30 #45-67',canal:'wpp',pago:'efectivo',estado:'cerrado',dom:'Andrés Castillo',hora:'06:45',pagado:true,reg:'encargado1',items:[{n:'Zanahoria',q:'500g',p:1750},{n:'Espinaca',q:'1 manojo',p:2000}],hist:[{who:'encargado1',what:'Pedido creado',t:'06:45',tipo:'create'},{who:'encargado1',what:'Estado',t:'07:15',tipo:'estado',antes:'En camino',despues:'Entregado'},{who:'encargado1',what:'Pago confirmado y cerrado',t:'07:20',tipo:'create'}]},
  {id:'p11',num:'011',cli:'Bernardo Gil',tel:'3111234511',dir:'Cra 70 #34-56, Bloque 3',canal:'llamada',pago:'transferencia',estado:'cerrado',dom:'Pedro Gómez',hora:'07:00',pagado:true,reg:'encargado2',items:[{n:'Papa Pastusa',q:'3 kg',p:7500},{n:'Arroz 500g',q:'2 und',p:6000},{n:'Panela',q:'1 und',p:3500}],hist:[{who:'encargado2',what:'Pedido creado',t:'07:00',tipo:'create'},{who:'encargado2',what:'Estado',t:'07:45',tipo:'estado',antes:'En camino',despues:'Entregado'},{who:'encargado2',what:'Pago confirmado y cerrado',t:'07:50',tipo:'create'}]},
];
let papelera=[];

// ── Tickets WPP (registro inmutable — pedidoIds[] permite múltiples pedidos) ──
let tickets=[
  {id:'t1',phone:'3011234501',name:'Rosario Díaz',pedidoIds:['p1'],createdAt:'07:10',msgs:[
    {from:'c',text:'Hola buenos días 🌞',t:'07:10'},
    {from:'c',text:'Quiero hacer un pedido por favor',t:'07:10'},
    {from:'a',text:'¡Buenos días! Con gusto, ¿qué desea pedir?',t:'07:11'},
    {from:'c',text:'Papa pastusa 2 kg, tomate chonto 1 kg, cebolla 1 kg y un manojo de cilantro',t:'07:12'},
    {from:'a',text:'Anotado 👍 ¿Cuál es su dirección de entrega?',t:'07:13'},
    {from:'c',text:'Cra 52 #18-40, Casa 3, timbre azul',t:'07:14'},
    {from:'c',text:'¿y pueden cobrar en casa?',t:'07:15'},
    {from:'a',text:'Sí claro, registrado. El domiciliario estará pronto 🛵',t:'07:20'},
    {from:'c',text:'Gracias! Ah, también necesito aguacate 2 und',t:'07:55'},
    {from:'a',text:'Claro, le creo otro pedido para ese envío',t:'07:56'},
  ]},
  {id:'t2',phone:'3021234502',name:'Fermín Vargas',pedidoIds:['p2'],createdAt:'07:35',msgs:[
    {from:'c',text:'Buenas, ¿tienen aguacate hass?',t:'07:35'},
    {from:'a',text:'Sí señor, disponible',t:'07:36'},
    {from:'c',text:'Me manda 3 aguacates y 6 limones tahití',t:'07:37'},
    {from:'a',text:'¿Dirección?',t:'07:37'},
    {from:'c',text:'Cll 34 #90-12, Apto 204',t:'07:38'},
    {from:'c',text:'Pago por transferencia',t:'07:38'},
    {from:'a',text:'Listo, pedido registrado 📦',t:'07:40'},
  ]},
  {id:'t3',phone:'3041234504',name:'Patricia Mora',pedidoIds:['p4'],createdAt:'08:05',msgs:[
    {from:'c',text:'Buen día! Me pueden mandar lulo y mora',t:'08:05'},
    {from:'a',text:'Claro que sí ¿cuánto de cada uno?',t:'08:06'},
    {from:'c',text:'2 lujos y 500g de mora',t:'08:06'},
    {from:'a',text:'¿Dirección?',t:'08:07'},
    {from:'c',text:'Cra 43A #14-12, Piso 2',t:'08:07'},
    {from:'c',text:'Pago en efectivo',t:'08:07'},
    {from:'a',text:'Perfecto, queda en preparación ✅',t:'08:08'},
  ]},
  {id:'t4',phone:'3071234507',name:'María González',pedidoIds:['p7'],createdAt:'08:42',msgs:[
    {from:'c',text:'Hola buen día',t:'08:42'},
    {from:'c',text:'Papa pastusa 2 kg y tomate 1 kg por favor',t:'08:42'},
    {from:'a',text:'Sí, ¿dirección?',t:'08:43'},
    {from:'c',text:'Cra 80 #30-12',t:'08:43'},
    {from:'c',text:'Efectivo',t:'08:43'},
    {from:'a',text:'Registrado, pronto le atendemos 👍',t:'08:44'},
  ]},
  {id:'t5',phone:'3151239901',name:'Carolina Muñoz',pedidoIds:[],createdAt:'09:15',msgs:[
    {from:'c',text:'Buenas tardes, ¿tienen fresa?',t:'09:15'},
    {from:'a',text:'Hola, en este momento no. ¿Le interesa mora o lulo?',t:'09:16'},
    {from:'c',text:'Sí, 500g de mora y 2 lujos',t:'09:17'},
    {from:'c',text:'Y zanahoria 1 kg también',t:'09:17'},
    {from:'a',text:'Perfecto! ¿Dirección de entrega?',t:'09:18'},
    {from:'c',text:'Av El Poblado #5-123, Torre 2, Apto 801',t:'09:19'},
    {from:'c',text:'Pago transferencia',t:'09:19'},
  ]},
  {id:'t6',phone:'3162349902',name:'Jorge Pedraza',pedidoIds:[],createdAt:'09:28',msgs:[
    {from:'c',text:'Hola! Quiero pedir',t:'09:28'},
    {from:'c',text:'¿Tienen naranja y mango?',t:'09:28'},
  ]},
];

let npItems=[];
let detItems=[];
let curDetId=null;
let curCobroId=null;
let dirtyMap={};
let pendingAction=null;
let isAdmin=false;
let currentAdmTab='kanban';
let currentUser='';


function getLocalDateStr() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().split('T')[0];
}
let currentDateStr = getLocalDateStr();

pedidos.forEach(p => p.fecha = currentDateStr);
tickets.forEach(t => t.fecha = currentDateStr);

function changeDate(d) {
  currentDateStr = d;
  renderAllAdmin();
}

function getPedidos() {
  return pedidos.filter(p => p.fecha === currentDateStr);
}

const USERS={

  admin: {pwd:'admin', role:'Administrador', label:'Dueño', admin:true},
  jose:  {pwd:'jose',  role:'Encargado',     label:'Jose Alvarez', admin:false},
};

// ══════════════════════ UTILS ══════════════════════
function isUrg(p){return p.estado==='nuevo'&&mins(p.hora)>20;}
function mins(h){const[hh,mm]=h.split(':').map(Number);const n=new Date();return Math.max(0,(n.getHours()*60+n.getMinutes())-(hh*60+mm));}
function nowH(){const n=new Date();return n.getHours().toString().padStart(2,'0')+':'+n.getMinutes().toString().padStart(2,'0');}
function fmt(n){return'$'+(parseInt(n)||0).toLocaleString('es-CO');}
function whoNow(){return currentUser||'sistema';}
function pClass(p){return p==='efectivo'?'pe':p==='transferencia'?'pt':'pca';}
function pLabel(p){return p==='efectivo'?'Efectivo':p==='transferencia'?'Transferencia':'Cobra en casa';}
function isLocked(p){return p.pagado===true || p.cajaCerrada===true;}

// ══════════════════════ NAV ══════════════════════
function show(id){
  document.querySelectorAll('.scr').forEach(s=>{s.classList.remove('on');s.style.display='none';});
  const t=document.getElementById(id);
  if(t){t.style.display=id==='s-login'?'flex':'block';t.classList.add('on');}
  if(id==='s-admin'){renderAllAdmin();}
}
function tryNav(dest){
  const om=openMod();
  if(om&&dirtyMap[om]){pendingAction=()=>{forceClose(om);show(dest);};openWarn();return;}
  if(om)forceClose(om);
  show(dest);
}
function doLogin(){
  const u=(document.getElementById('usr').value||'').trim().toLowerCase();
  const p=(document.getElementById('pwd').value||'').trim();
  const err=document.getElementById('login-err');
  const cfg=USERS[u];
  if(!cfg||cfg.pwd!==p){err.textContent='Usuario o contraseña incorrectos.';return;}
  err.textContent='';
  currentUser=u;
  isAdmin=cfg.admin;
  // Header del panel
  document.getElementById('h-un').textContent=cfg.label;
  document.getElementById('h-rol').textContent=cfg.role;
  document.getElementById('h-av').textContent=cfg.label[0].toUpperCase();
  document.getElementById('h-av').className='uav'+(isAdmin?' adm':'');
  applyRoleUI();
  // Siempre arranca en tab swimlane
  document.querySelectorAll('.tab').forEach(b=>b.classList.remove('on'));
  document.querySelector('.tab').classList.add('on');
  switchMainTab('swimlane', document.querySelector('.tab'));
  show('s-admin');
}

function doLogout(){
  currentUser='';isAdmin=false;
  document.getElementById('usr').value='';
  document.getElementById('pwd').value='';
  document.getElementById('login-err').textContent='';
  show('s-login');
}

function applyRoleUI(){
  const adminOnly=['btn-cierre','tab-resumen'];
  adminOnly.forEach(id=>{
    const el=document.getElementById(id);
    if(el)el.style.display=isAdmin?'':'none';
  });
  // Si el trabajador estaba en resumen, volver a swimlane
  if(!isAdmin&&currentAdmTab==='resumen'){
    switchMainTab('swimlane',document.querySelector('.tab'));
  }
}

// ══════════════════════ MODAL MGMT ══════════════════════
function openMod(){return['m-nuevo','m-det'].find(id=>document.getElementById(id).classList.contains('on'))||null;}
function openModal(id){const o=openMod();if(o&&o!==id)return;document.getElementById(id).classList.add('on');}
function closeModal(id){document.getElementById(id).classList.remove('on');dirtyMap[id]=false;}
function forceClose(id){closeModal(id);if(id==='m-nuevo'){npItems=[];renderItems('np');}}
function tryClose(id){if(dirtyMap[id]){pendingAction=()=>forceClose(id);openWarn();return;}forceClose(id);}
function dirty(id){dirtyMap[id]=true;}
function openWarn(){document.getElementById('m-warn').classList.add('on');}
function closeWarn(){document.getElementById('m-warn').classList.remove('on');pendingAction=null;}
function discardGo(){document.getElementById('m-warn').classList.remove('on');if(pendingAction){pendingAction();pendingAction=null;}}

// ══════════════════════ NUEVO PEDIDO ══════════════════════
function tryOpenNuevo(){
  const o=openMod();
  if(o&&o!=='m-nuevo'){if(dirtyMap[o]){pendingAction=()=>{forceClose(o);_openNuevo();};openWarn();return;}forceClose(o);}
  _openNuevo();
}
function _openNuevo(){
  npItems=[];
  ['np-nom','np-tel','np-dir','np-ps'].forEach(id=>document.getElementById(id).value='');
  const previewWrap = document.getElementById('np-chat-wrap');
  if(previewWrap) previewWrap.style.display = 'none';
  document.getElementById('np-pd').classList.remove('on');
  renderItems('np');dirtyMap['m-nuevo']=false;
  show('s-admin');openModal('m-nuevo');
}
function regPedido(){
  const nom=document.getElementById('np-nom').value.trim();
  const dir=document.getElementById('np-dir').value.trim();
  if(!nom){alert('El nombre del cliente es obligatorio.');return;}
  if(!dir){alert('La dirección es obligatoria.');return;}
  const h=nowH();const num=String(pedidos.length+1).padStart(3,'0');
  const p={id:'px'+Date.now(),num,cli:nom,tel:document.getElementById('np-tel').value,
    dir,canal:document.getElementById('np-canal').value.includes('WhatsApp')?'wpp':'llamada',
    pago:document.getElementById('np-pago').value,estado:'nuevo',dom:document.getElementById('np-dom').value,
    hora:h,pagado:false,reg:whoNow(),items:npItems.map(i=>({...i})),
    hist:[{who:whoNow(),what:'Pedido creado',t:h,tipo:'create'}]};
  pedidos.unshift(p);
  // Vincular al ticket si viene de uno
  if(window._pendingTicketId){
    const tk=tickets.find(x=>x.id===window._pendingTicketId);
    if(tk)tk.pedidoIds.push(p.id);
    window._pendingTicketId=null;
    document.querySelector('#m-nuevo .mtit').textContent='Registrar nuevo pedido';
  }
  forceClose('m-nuevo');renderPanel();renderAllAdmin();
  toast('Pedido #'+num+' registrado');
}

// ══════════════════════ DETALLE ══════════════════════
function tryOpenDet(pid,fromAdmin){
  const o=openMod();
  if(o&&o!=='m-det'){if(dirtyMap[o]){pendingAction=()=>{forceClose(o);_openDet(pid,fromAdmin);};openWarn();return;}forceClose(o);}
  _openDet(pid,fromAdmin);
}
function _openDet(pid,fromAdmin){
  const p=pedidos.find(x=>x.id===pid);if(!p)return;
  curDetId=pid;
  const adm=fromAdmin||isAdmin;
  const locked=isLocked(p);

  document.getElementById('det-tit').textContent='Pedido #'+p.num;
  document.getElementById('det-sub').textContent=(p.canal==='wpp'?'WhatsApp':'Llamada')+' · '+p.hora;

  // Banner top
  const banner=document.getElementById('det-top-banner');
  if(locked){
    banner.innerHTML='<div class="locked-banner">🔒 Este pedido está cerrado · Pago confirmado · No se puede modificar</div>';
  } else if(adm){
    banner.innerHTML='<div class="admin-banner">⚠ Eres el dueño. Cualquier cambio quedará registrado en el historial.</div>';
  } else {
    banner.innerHTML='';
  }

  // Info fija
  const urg=isUrg(p);
  document.getElementById('det-info').innerHTML=`
    <div style="display:flex;justify-content:space-between;font-size:14px;margin-bottom:5px;">
      <span style="color:var(--gt);">Hora de llegada</span>
      <span style="font-weight:700;${urg?'color:var(--r)':''};">${p.hora}${urg?' ⚠ '+mins(p.hora)+'min sin atender':''}</span>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:14px;margin-bottom:5px;">
      <span style="color:var(--gt);">Estado actual</span>
      <span style="font-weight:800;">${EL[p.estado]||p.estado}</span>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:14px;margin-bottom:5px;">
      <span style="color:var(--gt);">Registrado por</span>
      <span style="font-weight:700;">${p.reg||'—'}</span>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:14px;">
      <span style="color:var(--gt);">Pago</span>
      <span style="font-weight:800;color:${locked?'#2E7D32':'var(--a)'};">${locked?'✅ Confirmado y cerrado':'⏳ Pendiente'}</span>
    </div>
  `;

  // Mover btns
  renderMovBtns(pid,locked);

  // Campos — disabled si bloqueado
  const fields=['det-nom','det-tel','det-dir','det-ps'];
  fields.forEach(id=>{const el=document.getElementById(id);if(el)el.disabled=locked;});
  ['det-pago','det-dom'].forEach(id=>{const el=document.getElementById(id);if(el)el.disabled=locked;});

  document.getElementById('det-nom').value=p.cli;
  document.getElementById('det-tel').value=p.tel;
  document.getElementById('det-dir').value=p.dir;
  document.getElementById('det-pago').value=p.pago;
  document.getElementById('det-dom').value=p.dom;
  detItems=p.items.map(i=>({...i}));
  document.getElementById('det-ps').value='';
  document.getElementById('det-pd').classList.remove('on');
  renderItems('det',locked);

  // Historial solo dueño
  const hw=document.getElementById('det-hist-wrap');
  if(adm){hw.style.display='block';renderHistBlock(p);}
  else{hw.style.display='none';}

  // Actions
  const ac=document.getElementById('det-actions');
  if(locked){
    ac.innerHTML='<button class="bsec" style="flex:1;" onclick="closeModal(\'m-det\')">Cerrar</button>';
  } else if(p.estado==='camino'||p.estado==='entregado'){
    // show "confirmar pago" button
    ac.innerHTML=`
      <button class="bdel" onclick="toPapelera()">🗑 Papelera</button>
      <button class="bsec" onclick="tryClose('m-det')">Cancelar</button>
      <button class="bverde" onclick="openConfirmCobro('${pid}')">💵 Confirmar pago</button>
      <button class="bpri" onclick="guardar(${adm})">✓ Guardar</button>
    `;
  } else {
    ac.innerHTML=`
      <button class="bdel" onclick="toPapelera()">🗑 Papelera</button>
      <button class="bsec" onclick="tryClose('m-det')">Cancelar</button>
      <button class="bpri" onclick="guardar(${adm})">✓ Guardar cambios</button>
    `;
  }

  dirtyMap['m-det']=false;
  show('s-admin');
  openModal('m-det');
}

function renderMovBtns(pid,locked){
  const p=pedidos.find(x=>x.id===pid);
  document.getElementById('det-mover').innerHTML=ESTADOS.map(e=>{
    const dis=locked?' disabled':'';
    return`<button class="mbtn ${p.estado===e?'cur':''}"${dis} onclick="moverPed('${pid}','${e}')">${EL[e]}</button>`;
  }).join('');
}

function moverPed(pid,estado){
  const p=pedidos.find(x=>x.id===pid);
  if(!p||p.estado===estado||isLocked(p))return;
  const prev=p.estado;p.estado=estado;
  p.hist.push({who:whoNow(),what:'Estado',t:nowH(),tipo:'estado',antes:EL[prev],despues:EL[estado]});
  renderMovBtns(pid,false);
  dirty('m-det');renderPanel();renderAllAdmin();
  if(isAdmin)renderHistBlock(p);
  toast('Movido a '+EL[estado]);
}

function guardar(adm){
  if(adm){if(!confirm('¿Confirmas los cambios? Esta acción quedará registrada en el historial.'))return;}
  const p=pedidos.find(x=>x.id===curDetId);
  if(!p||isLocked(p))return;
  const who=whoNow();const t=nowH();
  const nn=document.getElementById('det-nom').value.trim();
  const nt=document.getElementById('det-tel').value.trim();
  const nd=document.getElementById('det-dir').value.trim();
  const np2=document.getElementById('det-pago').value;
  const ndom=document.getElementById('det-dom').value;
  if(nn!==p.cli){p.hist.push({who,what:'Nombre',t,tipo:'edit',antes:p.cli,despues:nn});p.cli=nn;}
  if(nt!==p.tel){p.hist.push({who,what:'Teléfono',t,tipo:'edit',antes:p.tel,despues:nt});p.tel=nt;}
  if(nd!==p.dir){p.hist.push({who,what:'Dirección',t,tipo:'edit',antes:p.dir,despues:nd});p.dir=nd;}
  if(np2!==p.pago){p.hist.push({who,what:'Método de pago',t,tipo:'edit',antes:pLabel(p.pago),despues:pLabel(np2)});p.pago=np2;}
  if(ndom!==p.dom){p.hist.push({who,what:'Domiciliario',t,tipo:'edit',antes:p.dom||'Sin asignar',despues:ndom||'Sin asignar'});p.dom=ndom;}
  const pi=JSON.stringify(p.items);
  p.items=detItems.map(i=>({...i}));
  if(JSON.stringify(p.items)!==pi)p.hist.push({who,what:'Productos actualizados',t,tipo:'edit',antes:null,despues:null});
  closeModal('m-det');renderPanel();renderAllAdmin();
  toast('Cambios guardados');
}

function toPapelera(){
  const p=pedidos.find(x=>x.id===curDetId);
  if(!p||isLocked(p))return;
  papelera.push({...p,quien:whoNow(),tPap:nowH()});
  p.estado='papelera';
  p.hist.push({who:whoNow(),what:'Enviado a papelera',t:nowH(),tipo:'edit',antes:null,despues:null});
  closeModal('m-det');renderPanel();renderAllAdmin();
  toast('Pedido enviado a papelera');
}

function renderHistBlock(p){
  const body=document.getElementById('det-hist-body');
  const cnt=document.getElementById('det-hist-cnt');
  if(cnt)cnt.textContent=p.hist.length;
  body.innerHTML=p.hist.map(h=>{
    let extra='';
    if((h.tipo==='edit'||h.tipo==='estado')&&h.antes!==null&&h.despues!==null){
      extra=`<div style="margin-top:4px;"><span class="diff-old">− ${h.antes}</span><span class="diff-arrow">→</span><span class="diff-new">+ ${h.despues}</span></div>`;
    }
    return`<div class="hitem"><div class="hdot"></div><div style="flex:1;"><div><span class="hwho">${h.who}</span> · <span class="hwhat">${h.what}</span></div>${extra}<div class="hwhen">${h.t}</div></div></div>`;
  }).join('');
}

function toggleHist(){
  const tog=document.getElementById('det-hist-tog');
  const bod=document.getElementById('det-hist-body');
  tog.classList.toggle('open');bod.classList.toggle('open');
}

// ══════════════════════ COBRO CONFIRM ══════════════════════
function openConfirmCobro(pid){
  curCobroId=pid;
  const p=pedidos.find(x=>x.id===pid);if(!p)return;
  const tot=p.items.reduce((s,i)=>s+(parseInt(i.p)||0),0);
  document.getElementById('cc-info').textContent='Cliente: '+p.cli+' · '+fmt(tot);
  document.getElementById('cc-rec').value='';
  document.getElementById('cc-dev').textContent='$0';
  
  const whoSel = document.getElementById('cc-who');
  if(whoSel) {
    whoSel.innerHTML = `<option value="${USERS[currentUser].label}">${USERS[currentUser].label} (Yo)</option>`;
    if(isAdmin) { whoSel.innerHTML += `<option value="Jose Alvarez">Jose Alvarez</option>`; }
  }
  
  // close det first if open
  closeModal('m-det');
  document.getElementById('m-confirm-cobro').classList.add('on');
}
function calcDevCC(){
  const p=pedidos.find(x=>x.id===curCobroId);if(!p)return;
  const tot=p.items.reduce((s,i)=>s+(parseInt(i.p)||0),0);
  const rec=parseInt(document.getElementById('cc-rec').value)||0;
  const dev=rec-tot;
  document.getElementById('cc-dev').textContent=dev>=0?fmt(dev):'⚠ Monto insuficiente';
}
function doCobro(){
  const p=pedidos.find(x=>x.id===curCobroId);if(!p)return;
  p.estado='cerrado';
  p.pagado=true;
  const cobradoPor = document.getElementById('cc-who')?.value || whoNow();
  p.hist.push({who:whoNow(),what:'Pago confirmado por '+cobradoPor,t:nowH(),tipo:'create'});
  document.getElementById('m-confirm-cobro').classList.remove('on');
  renderPanel();renderAllAdmin();
  toast('✅ Pago confirmado. Pedido cerrado.');
}

// ══════════════════════ PRODUCTOS ══════════════════════
function bProd(q,ctx){
  const drop=document.getElementById(ctx+'-pd');
  if(!q.trim()){drop.classList.remove('on');return;}
  const res=PRODS.filter(p=>p.n.toLowerCase().includes(q.toLowerCase())).slice(0,6);
  if(!res.length){drop.classList.remove('on');return;}
  drop.innerHTML=res.map(p=>`<div class="popt" onclick="addProd('${ctx}','${p.n}')"><div><div class="popt-n">${p.n}</div><div class="popt-c">${p.c}</div></div><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--v)" stroke-width="3"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></div>`).join('');
  drop.classList.add('on');
}
function addProd(ctx,nom){
  const p=pedidos.find(x=>x.id===curDetId);
  if(ctx==='det'&&p&&isLocked(p))return;
  const arr=ctx==='np'?npItems:detItems;
  arr.push({n:nom,q:'',p:''});
  document.getElementById(ctx+'-pd').classList.remove('on');
  document.getElementById(ctx==='np'?'np-ps':'det-ps').value='';
  if(ctx==='np')dirty('m-nuevo');else dirty('m-det');
  renderItems(ctx,ctx==='det'&&p&&isLocked(p));
  setTimeout(()=>{const ins=document.querySelectorAll(`#${ctx}-il .iinput`);if(ins.length)ins[ins.length-2].focus();},50);
}
function renderItems(ctx,locked=false){
  const arr=ctx==='np'?npItems:detItems;
  const list=document.getElementById(ctx+'-il');
  list.innerHTML='<div class="irow hdr'+(locked?' locked-row':'')+'"><div>Producto</div><div>Cantidad</div><div>Precio</div>'+(locked?'':'<div></div>')+'</div>';
  arr.forEach((item,i)=>{
    const row=document.createElement('div');
    row.className='irow'+(locked?' locked-row':'');
    row.innerHTML=locked
      ?`<div class="iname">${item.n}</div><div style="font-size:14px;">${item.q}</div><div style="font-size:14px;font-weight:700;">${item.p?fmt(item.p):'—'}</div>`
      :`<div class="iname">${item.n}</div><input class="iinput" type="text" placeholder="Ej: 2 kg" value="${item.q}" oninput="upItem('${ctx}',${i},'q',this.value)"><input class="iinput" type="number" placeholder="$0" value="${item.p}" oninput="upItem('${ctx}',${i},'p',this.value)"><button class="idel" onclick="remItem('${ctx}',${i})">×</button>`;
    list.appendChild(row);
  });
  upFact(ctx);
}
function upItem(ctx,i,f,v){const arr=ctx==='np'?npItems:detItems;if(arr[i])arr[i][f]=f==='p'?parseInt(v)||0:v;upFact(ctx);}
function remItem(ctx,i){const arr=ctx==='np'?npItems:detItems;arr.splice(i,1);renderItems(ctx);}
function upFact(ctx){
  const arr=ctx==='np'?npItems:detItems;
  const rows=document.getElementById(ctx+'-fr');
  const tot=document.getElementById(ctx+'-tot');
  let total=0;
  rows.innerHTML=arr.map(item=>{const p=parseInt(item.p)||0;total+=p;return`<div class="factrow"><span>${item.n}${item.q?' — '+item.q:''}</span><span>${p?fmt(p):'—'}</span></div>`;}).join('')||'<div style="font-size:13px;color:var(--gt);text-align:center;padding:8px 0;">Agrega productos con el buscador</div>';
  tot.textContent=fmt(total);
}

// ══════════════════════ KANBAN ══════════════════════
function filterRender(){
  const q=document.getElementById('srch').value.toLowerCase();
  const est=document.getElementById('fest').value;
  const pag=document.getElementById('fpago').value;
  renderKanban('kboard',q,est,pag,false);
}
function renderPanel(){
  const n=new Date();
  const fecha=n.toLocaleDateString('es-CO',{weekday:'long',day:'numeric',month:'long'});
  const act=getPedidos().filter(p=>p.estado!=='entregado'&&p.estado!=='papelera').length;
  const urg=getPedidos().filter(p=>isUrg(p)).length;
  const meta=document.getElementById('panel-meta');
  if(meta)meta.textContent=fecha+' · '+getPedidos().filter(p=>p.estado!=='papelera').length+' pedidos · '+act+' activos'+(urg>0?' · ⚠ '+urg+' urgentes':'');
  renderSwimlane();
}

function renderKanban(boardId,q,est,pag,forAdmin){
  const board=document.getElementById(boardId);if(!board)return;
  board.innerHTML='';
  ESTADOS.forEach(estado=>{
    let items=getPedidos().filter(p=>p.estado===estado);
    if(q)items=items.filter(p=>p.cli.toLowerCase().includes(q)||p.dir.toLowerCase().includes(q)||p.hora.includes(q)||p.items.some(i=>i.n.toLowerCase().includes(q))||p.num.includes(q));
    if(est&&est!==estado)items=[];
    if(pag)items=items.filter(p=>p.pago===pag);

    const col=document.createElement('div');
    col.className='kcol '+EC[estado];
    // Full column drop
    col.addEventListener('dragover',e=>{e.preventDefault();col.classList.add('dov');});
    col.addEventListener('dragleave',e=>{if(!col.contains(e.relatedTarget))col.classList.remove('dov');});
    col.addEventListener('drop',e=>{
      e.preventDefault();col.classList.remove('dov');
      const pid=e.dataTransfer.getData('pid');
      const p=pedidos.find(x=>x.id===pid);
      if(p&&p.estado!==estado&&!isLocked(p)){
        const prev=p.estado;p.estado=estado;
        p.hist.push({who:whoNow(),what:'Estado',t:nowH(),tipo:'estado',antes:EL[prev],despues:EL[estado]});
        renderPanel();renderAllAdmin();toast('Movido a '+EL[estado]);
      }
    });

    const allC=getPedidos().filter(p=>p.estado===estado).length;
    col.innerHTML=`<div class="colh"><div class="colt"><div class="cold"></div>${EL[estado]}</div><div class="colc">${allC}</div></div><div class="colb" id="${boardId}-${estado}"></div>`;
    board.appendChild(col);
    const cb=col.querySelector('.colb');
    if(!items.length){cb.innerHTML='<div class="ecol">Sin pedidos</div>';return;}
    items.sort((a,b)=>a.hora.localeCompare(b.hora));
    items.forEach(p=>{
      const card=document.createElement('div');
      const urg=isUrg(p);
      const locked=isLocked(p);
      const tot=p.items.reduce((s,i)=>s+(parseInt(i.p)||0),0);
      card.className='pcard'+(urg?' urg':'')+(locked?' locked':'');
      if(!locked){card.draggable=true;card.addEventListener('dragstart',e=>{e.dataTransfer.setData('pid',p.id);card.classList.add('dragging');});card.addEventListener('dragend',()=>card.classList.remove('dragging'));}
      card.innerHTML=`
        <div class="ptop"><span class="pnum">#${p.num}</span><span class="pcanal ${p.canal==='llamada'?'ll':''}">${p.canal==='wpp'?'WPP':'Llamada'}</span></div>
        <div class="pcli">${p.cli}</div>
        <div class="pprod">${p.items.slice(0,2).map(i=>i.n+(i.q?' '+i.q:'')).join(', ')}${p.items.length>2?' +'+(p.items.length-2)+' más':''}</div>
        <div class="pbot"><span class="phora">${p.hora}</span>${urg?`<span class="purg">⚠ ${mins(p.hora)}min</span>`:`<span class="pbadge ${pClass(p.pago)}">${pLabel(p.pago)}</span>`}</div>
        ${tot?`<div class="ptotal">${fmt(tot)}</div>`:''}
        <div class="pago-status ${locked?'pagado':'pendiente'}">
          ${locked?'<span class="lock-icon">🔒</span> Pagado y cerrado':'<span class="lock-icon">⏳</span> Sin cobrar'}
        </div>
      `;
      card.addEventListener('click',()=>tryOpenDet(p.id,forAdmin));
      cb.appendChild(card);
    });
  });
}

function renderDomicilios(stripId){
  const strip=document.getElementById(stripId);if(!strip)return;
  const domE=['preparando','listo','camino'];
  const doms=getPedidos().filter(p=>domE.includes(p.estado)&&p.dom);
  if(!doms.length){strip.innerHTML='';return;}
  strip.innerHTML=`
    <div class="dsh"><div class="dsht">🛵 Domicilios activos</div><span class="tbadge">${doms.length}</span></div>
    <div class="dgrid">
      ${doms.map(p=>{
        const tot=p.items.reduce((s,i)=>s+(parseInt(i.p)||0),0);
        const eLabel={preparando:'Preparando',listo:'Listo',camino:'En camino'};
        return`<div class="dcard">
          <div class="dcnum">#${p.num} · ${p.hora} · <span style="font-weight:700;color:var(--v);">${eLabel[p.estado]||p.estado}</span></div>
          <div class="dccli">${p.cli}</div>
          <div style="font-size:12px;color:var(--gt);margin-bottom:4px;">${p.dir.substring(0,36)}${p.dir.length>36?'...':''}</div>
          <div style="font-size:13px;color:var(--gt);margin-bottom:4px;">🛵 ${p.dom}</div>
          <div class="dcbot">
            <span class="dcmonto">${p.pago==='transferencia'?'Transfer':fmt(tot)}</span>
            ${p.estado==='camino'?`<button class="bpago" onclick="openConfirmCobro('${p.id}')">💵 Cobrar</button>`:''}
          </div>
        </div>`;
      }).join('')}
    </div>
  `;
}

// ══════════════════════ ADMIN ══════════════════════
function renderAllAdmin(){
  const dateInput = document.getElementById('ui-date');
  if(dateInput && !dateInput.value) dateInput.value = currentDateStr;
  renderTotales();
  renderSwimlane();
  renderAdminList('');
  renderPapelera();
  renderEditados();
}

function renderTotales(){
  // PRECISOS: basados en estado real de las columnas
  const todos=getPedidos().filter(p=>p.estado!=='papelera');
  const entregados=todos.filter(p=>p.estado==='cerrado'); // Solo los cobrados exitosamente
  const pendientes=todos.filter(p=>p.estado!=='cerrado');
  const domE=['preparando','listo','camino'];
  const domAct=todos.filter(p=>domE.includes(p.estado)&&p.dom);

  document.getElementById('a-tot').textContent=todos.length;
  document.getElementById('a-ent').textContent=entregados.length;
  document.getElementById('a-pen').textContent=pendientes.length;
  document.getElementById('a-dom').textContent=domAct.length;

  // Dinero: SOLO pedidos pagados y cerrados
  let ef=0,tr=0;
  getPedidos().filter(p=>p.pagado).forEach(p=>{
    const tot=p.items.reduce((s,i)=>s+(parseInt(i.p)||0),0);
    if(p.pago==='efectivo'||p.pago==='casa') ef+=tot;
    else if(p.pago==='transferencia') tr+=tot;
  });
  document.getElementById('d-ef').textContent=fmt(ef);
  document.getElementById('d-tr').textContent=fmt(tr);
  document.getElementById('d-tot').textContent=fmt(ef+tr);
}

function renderAdmKanban(){
  const q=(document.getElementById('adm-srch')?.value||'').toLowerCase();
  const pag=document.getElementById('adm-fpago')?.value||'';
  const est=document.getElementById('adm-fest2')?.value||'';
  const fech=document.getElementById('adm-fecha')?.value||'';
  // for demo all dates show (real app would filter by date)
  renderKanban('adm-kboard',q,est,pag,true);
  renderDomicilios('adm-dstrip');
  const n=getPedidos().filter(p=>p.estado!=='papelera').length;
  const meta=document.getElementById('adm-kmeta');
  if(meta)meta.textContent=n+' pedidos'+(fech?' · '+fech:'');
}

function renderAdminList(q){
  const list=document.getElementById('adm-list');if(!list)return;
  const est=document.getElementById('adm-fest2')?.value||'';
  let items=getPedidos().filter(p=>p.estado!=='papelera');
  if(q)items=items.filter(p=>p.cli.toLowerCase().includes(q.toLowerCase())||p.num.includes(q));
  if(est)items=items.filter(p=>p.estado===est);
  items.sort((a,b)=>a.hora.localeCompare(b.hora));
  const ec={nuevo:'e1',preparando:'e2',listo:'e5',camino:'e3',entregado:'e4'};
  let totalEnt=0;
  list.innerHTML=items.map(p=>{
    const tot=p.items.reduce((s,i)=>s+(parseInt(i.p)||0),0);
    if(p.estado==='entregado'&&p.pagado)totalEnt+=tot;
    const urg=isUrg(p);
    const locked=isLocked(p);
    return`<div class="hrow" onclick="tryOpenDet('${p.id}',true)" style="${urg?'background:var(--rc);':''}">
      <div class="hnum">#${p.num}</div>
      <div><div class="hcli">${p.cli}${urg?` <span style="color:var(--r);font-size:12px;font-weight:800;">⚠${mins(p.hora)}m</span>`:''}${locked?' 🔒':''}</div><div class="hdir">${p.dir.substring(0,40)}</div></div>
      <div style="font-size:12px;color:var(--gt);font-weight:600;">${p.hora}</div>
      <div><span class="ebadge ${ec[p.estado]||'e5'}">${EL[p.estado]||p.estado}</span></div>
      <div><span class="pbadge ${pClass(p.pago)}" style="font-size:12px;">${tot?fmt(tot):pLabel(p.pago)}</span></div>
    </div>`;
  }).join('')||'<div style="padding:20px;text-align:center;color:var(--gt);font-size:14px;">Sin resultados</div>';
  const ttxt=document.getElementById('adm-total-txt');
  if(ttxt)ttxt.textContent='Total cobrado: '+fmt(totalEnt);
}

function renderPapelera(){
  const div=document.getElementById('adm-papelera');if(!div)return;
  document.getElementById('pap-cnt').textContent='('+papelera.length+')';
  div.innerHTML=papelera.length?papelera.map(p=>`
    <div class="papcard">
      <div style="display:flex;justify-content:space-between;margin-bottom:6px;"><span style="font-size:14px;font-weight:800;">#${p.num}</span><span style="font-size:12px;font-weight:700;color:var(--r);">🗑 ${p.tPap}</span></div>
      <div style="font-size:15px;font-weight:800;margin-bottom:4px;">${p.cli} — ${p.dir}</div>
      <div style="font-size:13px;color:var(--gt);">Enviado por: ${p.quien}</div>
      <div style="font-size:13px;color:var(--gt);">Productos: ${p.items.map(i=>i.n+(i.q?' '+i.q:'')).join(', ')}</div>
    </div>`).join('')
    :'<div style="padding:20px;text-align:center;color:var(--gt);font-size:14px;">Sin pedidos en papelera</div>';
}

function renderEditados(){
  const div=document.getElementById('adm-editados');if(!div)return;
  const edits=[];
  pedidos.forEach(p=>p.hist.filter(h=>h.tipo==='edit'||h.tipo==='estado').forEach(h=>edits.push({...h,pnum:p.num,pcli:p.cli})));
  document.getElementById('edit-cnt').textContent='('+edits.length+')';
  div.innerHTML=edits.length?[...edits].reverse().map(e=>`
    <div class="elogcard">
      <div style="display:flex;justify-content:space-between;margin-bottom:5px;"><span style="font-size:14px;font-weight:800;">Pedido #${e.pnum} — ${e.pcli}</span><span style="font-size:12px;font-weight:700;color:var(--a);">✏️ ${e.t}</span></div>
      <div style="font-size:15px;font-weight:800;margin-bottom:6px;">${e.what}</div>
      ${e.antes!==null&&e.despues!==null?`<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:5px;"><span class="diff-old">− ${e.antes}</span><span class="diff-arrow">→</span><span class="diff-new">+ ${e.despues}</span></div>`:''}
      <div style="font-size:13px;color:var(--gt);">Por: ${e.who}</div>
    </div>`).join('')
    :'<div style="padding:20px;text-align:center;color:var(--gt);font-size:14px;">Sin cambios registrados</div>';
}

function switchMainTab(tab,btn){
  document.querySelectorAll('.tab').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
  currentAdmTab=tab;
  document.getElementById('adm-swimlane').style.display=tab==='swimlane'?'block':'none';
  document.getElementById('adm-resumen').style.display=tab==='resumen'?'block':'none';
  if(tab==='swimlane')renderSwimlane();
  if(tab==='resumen')renderTotales();
}

function switchAdmTab(tab,btn){
  document.querySelectorAll('.atab').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
  ['adm-todos','adm-papelera','adm-editados'].forEach(id=>document.getElementById(id).style.display='none');
  document.getElementById('adm-'+tab).style.display='block';
  if(tab==='papelera')renderPapelera();
  if(tab==='editados')renderEditados();
  if(tab==='todos')renderAdminList('');
}

// ══════════════════════ SWIMLANE ══════════════════════


function tkUrgMin(t){
  // Minutos esperando sin pedido de despacho
  const peds=t.pedidoIds.map(id=>pedidos.find(p=>p.id===id)).filter(p=>p&&p.estado!=='papelera');
  if(!peds.length) return mins(t.createdAt);
  // O si tiene pedido en nuevo > 20min
  const newUrg=peds.filter(p=>isUrg(p));
  return newUrg.length? mins(newUrg[0].hora): 0;
}
function tkNum(t){return 'T-'+String(tickets.indexOf(t)+1).padStart(2,'0');}

function renderSwimlane(){
  const wrap=document.getElementById('swimlane');if(!wrap)return;
  const q=(document.getElementById('srch')?.value||'').toLowerCase();
  const pag=document.getElementById('fpago')?.value||'';

  let tks=tickets;
  if(q)tks=tks.filter(t=>{
    const peds=t.pedidoIds.map(id=>pedidos.find(p=>p.id===id)).filter(Boolean);
    return t.name.toLowerCase().includes(q)||t.phone.includes(q)||
      peds.some(p=>p.dir.toLowerCase().includes(q)||p.items.some(i=>i.n.toLowerCase().includes(q))||p.num.includes(q));
  });
  if(pag)tks=tks.filter(t=>{
    const peds=t.pedidoIds.map(id=>pedidos.find(p=>p.id===id)).filter(Boolean);
    return !peds.length||peds.some(p=>p.pago===pag);
  });

  // ── Zona roja: tickets sin atender > 15min ──────────────────
  const urgentes=tickets.filter(t=>tkUrgMin(t)>15);
  let h='';
  if(urgentes.length){
    h+=`<div class="urg-strip">
      <div class="urg-strip-lbl">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        Zona roja — sin atención:
      </div>`;
    urgentes.forEach(t=>{
      const m=tkUrgMin(t);
      h+=`<div class="urg-chip" onclick="openTicket('${t.id}')">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        ${tkNum(t)} · ${t.name.split(' ')[0]} · ${m}min
      </div>`;
    });
    h+='</div>';
  }

  h+='<div class="slane">';
  h+='<div class="slane-hcell wpp-col">💬 Tickets WPP</div>';
  ESTADOS.forEach(e=>{h+=`<div class="slane-hcell" style="border-top:3px solid ${COL_COLORS[e]};">${EL[e]}</div>`;});

  if(!tks.length){
    h+=`<div style="grid-column:1/-1;padding:28px;text-align:center;background:var(--b);color:var(--gt);font-size:14px;">Sin tickets</div>`;
  }

  tks.forEach(t=>{
    const peds=t.pedidoIds.map(id=>pedidos.find(p=>p.id===id)).filter(p=>p&&p.estado!=='papelera');
    const lastMsg=t.msgs[t.msgs.length-1];
    const hasPending=peds.some(p=>!p.pagado);
    const allDone=peds.length>0&&peds.every(p=>p.pagado);
    const urgMin=tkUrgMin(t);
    const isUrgTk=urgMin>15;
    const num=tkNum(t);

    // Badge de estado
    let badgeTxt,badgeCls;
    if(!peds.length){badgeTxt='⚠ Sin pedido';badgeCls='sin';}
    else if(allDone){badgeTxt='✅ Completado';badgeCls='done';}
    else if(hasPending){badgeTxt=`🔄 ${peds.length} pedido${peds.length>1?'s':''}`;badgeCls='activo';}
    else{badgeTxt='🆕 Nuevo';badgeCls='nuevo';}

    h+=`<div class="slane-tcell${isUrgTk?' urg':''}" onclick="openTicket('${t.id}')">
      ${t.unreadCount?`<div class="tk-new-dot">${t.unreadCount}</div>`:''}
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:6px;margin-bottom:3px;">
        <div style="font-size:12px;font-weight:800;color:var(--gt);">${num}</div>
        ${isUrgTk
          ?`<div class="tk-urg"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>${urgMin}min</div>`
          :''}
      </div>
      <div class="tk-phone">📱 ${t.phone}</div>
      <div class="tk-name">${t.name}</div>
      <div class="tk-preview">${lastMsg.text}</div>
      <div class="tk-foot">
        <span class="tk-time">🕐 ${t.createdAt}</span>
        <span class="tk-badge ${badgeCls}">${badgeTxt}</span>
      </div>
      <button class="tk-ver-btn" onclick="event.stopPropagation();openTicket('${t.id}')">Ver conversación →</button>
      <button class="tk-crear-btn" onclick="event.stopPropagation();createFromTicket('${t.id}')">+ Crear pedido de despacho</button>
    </div>`;

    // Celdas de estado
    ESTADOS.forEach((e,idx)=>{
      const inState=peds.filter(p=>p.estado===e);
      if(inState.length){
        h+=`<div class="slane-scell" style="align-items:flex-start;justify-content:flex-start;flex-direction:column;gap:7px;display:flex;" ondragover="event.preventDefault();this.style.background='#F0FAF4'" ondragleave="this.style.background=''" ondrop="dropDC(event,'${t.id}','${e}')">`;
        inState.forEach(ped=>{
          const tot=ped.items.reduce((s,i)=>s+(parseInt(i.p)||0),0);
          const locked=isLocked(ped);
          const pedUrg=isUrg(ped);
          h+=`<div class="dc-wrap" ${ped.cajaCerrada?'style="filter:grayscale(1);opacity:0.65;"':''}>
            <div class="dc-card${pedUrg?' urg':''}" style="border-left-color:${pedUrg?'var(--r)':COL_COLORS[e]};" ${!locked?`draggable="true" ondragstart="event.dataTransfer.setData('pid','${ped.id}');event.dataTransfer.setData('tid','${t.id}');"`:''}>
              <div class="dc-num">#${ped.num}${locked?' 🔒':pedUrg?` <span style="color:var(--r);font-size:11px;">⚠${mins(ped.hora)}min</span>`:''}</div>
              <div class="dc-prod">${ped.items.slice(0,2).map(i=>i.n+(i.q?' '+i.q:'')).join(', ')}${ped.items.length>2?' +'+(ped.items.length-2)+' más':''}</div>
              ${tot?`<div class="dc-tot">${fmt(tot)}</div>`:''}
              <div class="dc-nav">
                <button class="dc-btn" title="Retroceder" ${(idx===0||locked)?'disabled':''} onclick="moveDC('${ped.id}',-1)">‹</button>
                <button class="dc-det-btn" onclick="tryOpenDet('${ped.id}',true)">Ver detalle</button>
                <button class="dc-btn" title="Avanzar" ${(idx===ESTADOS.length-1||locked)?'disabled':''} onclick="moveDC('${ped.id}',1)">›</button>
              </div>
            </div>
          </div>`;
        });
        h+='</div>';
      } else {
        h+=`<div class="slane-scell" ondragover="event.preventDefault();this.style.background='#F0FAF4'" ondragleave="this.style.background=''" ondrop="dropDC(event,'${t.id}','${e}')"></div>`;
      }
    });
  });

  h+='</div>';
  wrap.innerHTML=h;
}

function moveDC(pid,dir){
  const p=pedidos.find(x=>x.id===pid);
  if(!p||isLocked(p))return;
  const idx=ESTADOS.indexOf(p.estado);
  const ni=idx+dir;
  if(ni<0||ni>=ESTADOS.length)return;
  const prev=p.estado;p.estado=ESTADOS[ni];
  p.hist.push({who:whoNow(),what:'Estado',t:nowH(),tipo:'estado',antes:EL[prev],despues:EL[p.estado]});
  renderSwimlane();renderAllAdmin();
  toast('Movido a '+EL[p.estado]);
}

function dropDC(e, targetTid, newEstado){
  e.preventDefault();
  e.currentTarget.style.background='';
  const pid = e.dataTransfer.getData('pid');
  const sourceTid = e.dataTransfer.getData('tid');
  if(sourceTid !== targetTid) {
    toast('⚠ Solo puedes moverlo en la fila de este cliente');
    return; 
  }
  const p = pedidos.find(x=>x.id===pid);
  if(p && !isLocked(p) && p.estado !== newEstado){
    const prev = p.estado;
    p.estado = newEstado;
    p.hist.push({who:whoNow(),what:'Estado (Arrastrado)',t:nowH(),tipo:'estado',antes:EL[prev],despues:EL[newEstado]});
    renderSwimlane();renderAllAdmin();
    toast('Movido a '+EL[newEstado]);
  }
}

// ══════════════════════ MODAL TICKET ══════════════════════
function openTicket(tid){
  const t=tickets.find(x=>x.id===tid);if(!t)return;
  if(t.unreadCount){ t.unreadCount = 0; renderSwimlane(); }
  const ped=t.pedidoId?pedidos.find(p=>p.id===t.pedidoId):null;
  document.getElementById('tk-tit').textContent='💬 '+t.name;
  document.getElementById('tk-sub').textContent='📱 '+t.phone+' · Recibido: '+t.createdAt+' · '+t.msgs.length+' mensajes';

  const chat=document.getElementById('tk-chat');
  chat.innerHTML='<div class="chat-sep">Hoy</div>'+t.msgs.map(m=>`
    <div class="chat-msg ${m.from==='c'?'them':'us'}">
      <div class="chat-bubble">${m.text}</div>
      <div class="chat-meta">${m.from==='c'?t.name:'Encargado'} · ${m.t}</div>
    </div>`).join('');
  setTimeout(()=>{chat.scrollTop=chat.scrollHeight;},60);

  const info=document.getElementById('tk-ped-info');
  const peds=t.pedidoIds.map(id=>pedidos.find(p=>p.id===id)).filter(p=>p&&p.estado!=='papelera');
  if(peds.length){
    let pHTML='';
    peds.forEach(ped=>{
      const tot=ped.items.reduce((s,i)=>s+(parseInt(i.p)||0),0);
      pHTML+=`<div style="background:var(--vc);border-radius:var(--rad);padding:12px 14px;margin-bottom:8px;">
        <div style="font-size:12px;font-weight:800;color:var(--vd);text-transform:uppercase;letter-spacing:.4px;margin-bottom:7px;">Pedido de despacho #${ped.num}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px 0;font-size:14px;">
          <span style="color:var(--gt);">Estado</span><span style="font-weight:800;">${EL[ped.estado]}</span>
          <span style="color:var(--gt);">Total</span><span style="font-weight:800;color:var(--v);">${fmt(tot)}</span>
          <span style="color:var(--gt);">Domiciliario</span><span style="font-weight:700;">${ped.dom||'Sin asignar'}</span>
          <span style="color:var(--gt);">Pago</span><span style="font-weight:800;color:${ped.pagado?'#2E7D32':'var(--a)'};">${ped.pagado?'✅ Cobrado':'⏳ Pendiente'}</span>
        </div>
        <button class="bverde" style="width:100%;margin-top:9px;padding:8px;" onclick="closeModal('m-ticket');tryOpenDet('${ped.id}',true)">Ver pedido #${ped.num} →</button>
      </div>`;
    });
    info.innerHTML=pHTML;
    document.getElementById('tk-actions').innerHTML=`
      <button class="bsec" onclick="closeModal('m-ticket')">Cerrar</button>
      <button class="bpri" onclick="closeModal('m-ticket');createFromTicket('${tid}')">+ Crear otro pedido</button>`;
  } else {
    info.innerHTML=`<div style="background:var(--ac);border:2px solid #FFCC80;border-radius:var(--rad);padding:12px 14px;margin-bottom:12px;font-size:14px;color:var(--a);font-weight:600;">
      ⚠ Este ticket aún no tiene pedido de despacho. El cliente está esperando atención.
    </div>`;
    document.getElementById('tk-actions').innerHTML=`
      <button class="bsec" onclick="closeModal('m-ticket')">Cerrar</button>
      <button class="bpri" onclick="closeModal('m-ticket');createFromTicket('${tid}')">+ Crear pedido de despacho</button>`;
  }
  document.getElementById('m-ticket').classList.add('on');
}

function createFromTicket(tid){
  const t=tickets.find(x=>x.id===tid);if(!t)return;
  _openNuevo();
  document.getElementById('np-nom').value=t.name;
  document.getElementById('np-tel').value=t.phone;
  window._pendingTicketId=tid;
  dirtyMap['m-nuevo']=false;
  
  const previewWrap = document.getElementById('np-chat-wrap');
  const preview = document.getElementById('np-chat-preview');
  if(previewWrap && preview) {
     previewWrap.style.display = 'block';
     preview.innerHTML = '<div style="font-size:11px;color:#667781;margin-bottom:6px;font-weight:bold;text-align:center;">💬 Conversación de WhatsApp</div>' + 
       t.msgs.map(m=>`
        <div class="chat-msg ${m.from==='c'?'them':'us'}" style="margin-bottom:5px; max-width:95%;">
          <div class="chat-bubble" style="padding:6px 10px;font-size:12px;display:inline-block;">${m.text}</div>
        </div>`).join('');
     setTimeout(()=>preview.scrollTop=preview.scrollHeight, 50);
  }
  
  // Mostrar de qué ticket viene
  const sub=document.querySelector('#m-nuevo .mtit');
  if(sub)sub.textContent='Nuevo pedido · '+t.name;
}

// ══════════════════════ CIERRE DE CAJA ══════════════════════
let cierreDecisions={};

function openCierre(){
  cierreDecisions={};
  document.getElementById('cierre-informe-wrap').style.display='none';
  const todos=getPedidos().filter(p=>p.estado!=='papelera');
  const pagados=todos.filter(p=>p.pagado);
  const pendientes=todos.filter(p=>!p.pagado);
  let ef=0,tr=0;
  pagados.forEach(p=>{
    const tot=p.items.reduce((s,i)=>s+(parseInt(i.p)||0),0);
    if(p.pago==='efectivo'||p.pago==='casa')ef+=tot;
    else if(p.pago==='transferencia')tr+=tot;
  });
  document.getElementById('cierre-ef').textContent=fmt(ef);
  document.getElementById('cierre-tr').textContent=fmt(tr);
  document.getElementById('cierre-gran-total').textContent=fmt(ef+tr);
  document.getElementById('cierre-stat-tot').textContent=todos.length;
  document.getElementById('cierre-stat-pag').textContent=pagados.length;
  document.getElementById('cierre-stat-pen').textContent=pendientes.length;
  document.getElementById('cierre-stat-pap').textContent=papelera.length;
  const sect=document.getElementById('cierre-warn-sect');
  const warn=document.getElementById('cierre-warn');
  const cnt=document.getElementById('cierre-warn-cnt');
  if(pendientes.length){
    cnt.textContent=pendientes.length+' pedido(s) sin resolver';
    sect.style.display='block';
    warn.innerHTML=pendientes.map(p=>{
      const tot=p.items.reduce((s,i)=>s+(parseInt(i.p)||0),0);
      return`<div class="warn-ord">
        <div style="flex:1;"><strong>#${p.num}</strong> ${p.cli}
          <div style="font-size:12px;color:var(--gt);margin-top:2px;">${EL[p.estado]} · ${tot?fmt(tot):pLabel(p.pago)}</div>
        </div>
        <select class="warn-sel" onchange="cierreDecisions['${p.id}']=this.value">
          <option value="">¿Qué hacer?</option>
          <option value="manana">📅 Pasar a mañana</option>
          <option value="forzar_cierre">✅ Forzar pago/cierre</option>
          <option value="cancelar">❌ Cancelar pedido</option>
        </select>
      </div>`;
    }).join('');
  } else {
    cnt.textContent='¡Todo resuelto!';
    sect.style.display='block';
    sect.style.borderColor='#A5D6A7';sect.style.background='#E8F5E9';
    warn.innerHTML='<div style="text-align:center;color:#2E7D32;font-size:14px;font-weight:700;padding:10px;">✅ No hay pedidos pendientes. Excelente día!</div>';
  }
  document.getElementById('m-cierre').classList.add('on');
}

function generarInforme(){
  const pend=getPedidos().filter(p=>p.estado!=='cerrado'&&p.estado!=='papelera');
  for(let p of pend){
    if(!cierreDecisions[p.id]){
      alert('Debes seleccionar una solución para todos los pedidos pendientes antes de cerrar la caja.');
      return;
    }
  }

  // Aplicar decisiones a pendientes
  pend.forEach(p => {
    const dec = cierreDecisions[p.id];
    if(dec === 'manana'){
      let d = new Date(currentDateStr+'T12:00:00Z');
      d.setDate(d.getDate()+1);
      p.fecha = d.toISOString().split('T')[0];
      p.hist.push({who:whoNow(),what:'Movido a mañana por cierre',t:nowH(),tipo:'edit'});
    } else if(dec === 'cancelar'){
      p.estado = 'papelera';
      p.hist.push({who:whoNow(),what:'Cancelado en cierre',t:nowH(),tipo:'edit'});
    } else if(dec === 'forzar_cierre'){
      p.estado = 'cerrado';
      p.pagado = true;
      p.hist.push({who:whoNow(),what:'Cerrado forzosamente en cierre',t:nowH(),tipo:'create'});
    }
  });

  // Marcar los de hoy como caja cerrada
  const todosHoy = pedidos.filter(p=>p.fecha===currentDateStr && p.estado!=='papelera');
  todosHoy.forEach(p => p.cajaCerrada = true);

  // Generar CSV
  let csv = "Fecha,Num,Cliente,Telefono,Total,Estado Final,Solucion en Cierre,Items\n";
  const informePedidos = pedidos.filter(p => (p.fecha===currentDateStr || p.hist.some(h=>h.what.includes('Movido a mañana por cierre') && h.t===nowH())) && p.estado!=='papelera');
  
  informePedidos.forEach(p => {
    const tot=p.items.reduce((s,i)=>s+(parseInt(i.p)||0),0);
    let est = p.pagado?'PAGADO':(cierreDecisions[p.id]==='manana'?'A MANANA':'CANCELADO');
    if(p.estado === 'papelera') est = 'CANCELADO';
    const sol=cierreDecisions[p.id]||'Completado normal';
    const it=p.items.map(i=>i.q+' '+i.n).join(' | ');
    csv += `"${currentDateStr}","${p.num}","${p.cli}","${p.tel}","${tot}","${est}","${sol}","${it}"\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Cierre_Fruver_${currentDateStr}.csv`;
  a.click();

  closeModal('m-cierre');
  renderAllAdmin();
  toast('Caja cerrada y reporte en Excel (CSV) descargado');
}

// ══════════════════════ TOAST ══════════════════════
let tt;
function toast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('on');clearTimeout(tt);tt=setTimeout(()=>t.classList.remove('on'),2800);}

// ══════════════════════ SIMULADOR WPP (MOCKUP DEMO) ══════════════════════
let demoMessageCount = 0;
function simulateIncomingMessage() {
  const delay = demoMessageCount === 0 ? 12000 : 40000; // 12 segs para el primero, 40s para el resto
  setTimeout(() => {
    // Solo simular si estamos logueados en el panel
    if(document.getElementById('s-admin').classList.contains('on') && currentUser) {
      demoMessageCount++;
      const id = 't_sim_' + Date.now();
      const h = nowH();
      
      let name, msgs;
      if (demoMessageCount === 1) {
         name = "Laura Gómez (Demo)";
         msgs = [
           {from:'c', text:'Hola buenas tardes ☀️', t: h},
           {from:'c', text:'Necesito urgente 3 libras de tomate y 1 de cebolla, ¿me lo pueden mandar ya?', t: h}
         ];
      } else {
         name = "Cliente " + demoMessageCount + " (Demo)";
         msgs = [
           {from:'c', text:'Hola, para hacer un pedido por favor', t: h}
         ];
      }
      
      const existingTk = tickets.find(x => x.name === name);
      if(existingTk) {
         existingTk.msgs.push({from:'c', text:'¿Me pueden responder por favor? Es urgente', t: h});
         existingTk.unreadCount = (existingTk.unreadCount || 0) + 1;
      } else {
         tickets.push({
           id: id, phone: '320' + Math.floor(1000000 + Math.random() * 9000000),
           name: name, pedidoIds: [], createdAt: h, msgs: msgs,
           unreadCount: 1
         });
      }
      
      // Mostrar la alerta nativa del mockup
      toast('💬 Nuevo mensaje de WhatsApp de ' + name);
      
      // Rerenderizar la vista para que el ticket aparezca inmediatamente
      if(currentAdmTab==='swimlane') renderSwimlane();
    }
    simulateIncomingMessage();
  }, delay);
}

// Arrancar el simulador en segundo plano
simulateIncomingMessage();

// INIT — arranca en login
show('s-login');