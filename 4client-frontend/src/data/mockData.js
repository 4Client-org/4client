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


export { PRODS, ESTADOS, EL, COL_COLORS, EC, pedidos, papelera, tickets };
