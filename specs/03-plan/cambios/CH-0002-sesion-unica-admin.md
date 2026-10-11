---
id: CH-0002
estado: hecho en dev
clase: C
modulos: [ACC]
aprobado_por: José (2026-10-10, en conversación: "Activemos eso para administrador y para dev... no se notifica... el encargado puede tener varias sesiones")
---

# CH-0002 — Sesión única para administrador y dev

## Spec (qué y por qué)

Si alguien compromete la cuenta de un administrador o de `dev`, hoy puede tener su propia sesión abierta al mismo tiempo que el dueño (cada login crea una sesión nueva sin cerrar las anteriores). José pidió que una cuenta de administrador o `dev` tenga **una sola sesión vigente**: al iniciar sesión, las anteriores se cierran y la nueva queda activa.

**Comportamiento**
- Administrador y `dev`: un login nuevo cierra todas sus sesiones anteriores al instante (HTTP y tiempo real). La sesión desplazada ve el mensaje "Tu sesión se cerró porque se inició en otro dispositivo".
- Encargado y domiciliario: pueden tener varias sesiones abiertas a la vez, como hasta hoy.
- Sin notificación por correo al dueño (decisión de José: por ahora no).
- Duración: el access token vale 15 min y se renueva solo con el refresh token (7 días); la sesión no vence a la hora.

**Reglas afectadas:** `+ RN-ACC` nueva (sesión única), `~` la de renovación de sesión.

**Fuera de alcance:** aviso por correo de sesión nueva; límite de dispositivos para encargado.

**Horizonte.** No cierra el camino a nada: ayuda al segundo cliente (cada administrador queda protegido) y al login por nombre de usuario.

## Plan (cómo)

Columna nueva `users.session_id` (nullable, aditiva). Al iniciar sesión, un admin/dev recibe un `sid` nuevo que se guarda en esa columna y viaja en su access token; se borran sus refresh tokens anteriores y se desconectan sus sockets. `authenticate` y el handshake del socket exigen que el `sid` coincida. Los tokens anteriores a esta regla (sin `sid`) siguen sirviendo hasta el siguiente login de esa cuenta. Los refresh tokens se borran (no se marcan revocados) para que una cookie vieja no dispare la detección de reuso y tumbe también a la sesión nueva.

**Riesgos y reversa.** Un admin que use la misma cuenta en dos computadores a la vez se echará a sí mismo: es lo pedido. Reversa: revertir el merge; la columna queda sin uso.

## Tareas

- [x] Migración, `issueSession`, refresh, `authenticate`, socket.
- [x] Web: aviso en el login y cierre en el cliente.
- [x] Tests (`session-unica.test.ts`).
- [ ] Probar en `dev`.
- [ ] Llevar a producción con OK de José.

## Verificación

328 pruebas de la API pasan (7 nuevas), `tsc` y `vite build` correctos. Pendiente: prueba manual en `dev`.
