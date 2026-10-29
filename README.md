# CONTABILIDAD DIGITAL · Plataforma contable multiempresa

Nombre comercial **provisional**: se cambia desde *Configuración → Marca e identidad* sin tocar código.

## Qué incluye

| Módulo | Estado |
|---|---|
| Sitio público premium con fondo vivo (canvas + CSS, respeta `prefers-reduced-motion`) | Listo |
| Tarjeta digital `/f/{identificador}`: WhatsApp, llamada, correo, vCard, cita, portal, mapa, redes | Listo |
| QR permanente PNG/SVG, identificadores de campaña, hoja de tarjetas para imprimir | Listo |
| Autenticación, recuperación de contraseña, invitaciones, roles (superadmin, contador admin, auxiliar, cliente) | Listo |
| Multiempresa con aislamiento por RLS + triggers que impiden cambiar `org_id`/`client_id` | Listo y probado |
| Permisos por organización, rol, cliente, módulo y acción (verificados en servidor) | Listo |
| CRM de clientes: ficha, contactos, notas internas, importación CSV/XLSX con vista previa y validación, exportación | Listo |
| Centro documental privado: arrastrar y soltar, validación de tipo/contenido/tamaño, SHA-256 y duplicados, versiones, enlaces temporales, registro de accesos, solicitudes al cliente | Listo |
| Extracción: XML UBL DIAN (incluye AttachedDocument) en servidor; OCR/IA con interfaz de proveedor (inactiva hasta configurar) | Listo / proveedor pendiente |
| Revisión del auxiliar → propuesta contable por reglas → aprobación del contador | Listo |
| Contabilidad: plan de cuentas por cliente (plantilla PUC opcional), terceros, centros de costo, comprobantes con partida doble, devolución, reverso, periodos y cierres | Listo y probado |
| Conciliación bancaria: importación, normalización, propuestas exactas/aproximadas, decisión justificada, manual, sin correspondencia, aprobación, exportación | Listo |
| Cartera CxC/CxP: antigüedad, proyección 30/60/90, pagos sin confirmar vs confirmados | Listo |
| Calendario tributario: reglas con fuente/versión/vigencia/verificación, fechas por dígito de NIT, generación por cliente, alertas | Listo (sin fechas oficiales precargadas, a propósito) |
| Centro de tareas (tablero y lista), automatizaciones sin duplicados, historial | Listo |
| Portal del cliente separado | Listo |
| Notificaciones internas; cola de correo/WhatsApp con límite por hora, deduplicación y registro | Listo / envío real pendiente de proveedor |
| Informes: balance de prueba, situación financiera, resultados, diario, mayor, por cuenta, por tercero, CxC, CxP, conciliación, ingresos y gastos, pendientes, faltantes, obligaciones. PDF/XLSX/CSV, preliminar vs. periodos cerrados | Listo |
| Auditoría inmodificable, exportaciones auditadas, acceso de soporte autorizado y temporal | Listo |
| Ley 1581: política versionada, formulario público de titulares, gestión de solicitudes | Listo |
| Planes, límites y uso; panel superadmin | Listo (cobros desactivados) |

## Estructura

```
supabase/migrations/   Esquema, RLS, funciones (aplicadas al proyecto contabilidad-digital)
supabase/functions/    process-document (desplegada) · dispatch-messages (lista, sin desplegar)
supabase/tests/        Pruebas de seguridad y contabilidad (se ejecutan y revierten)
web/                   App React + TypeScript (sin dependencias npm externas salvo React)
```

## Backend (Supabase)

Proyecto: `contabilidad-digital` (ref `mkviobxkrekekzdxmpty`, São Paulo).
Migraciones aplicadas: 0001 a 0005c, 0007, 0008. **Pendiente: 0006** (función para asignar clientes a auxiliares). Contiene una instrucción de borrado, por lo que Supabase exige aprobarla a mano: ábrala en *SQL Editor* y ejecute `supabase/migrations/0006_client_assignments.sql`.

Pruebas ejecutadas contra la base real (29 + 4 casos, 0 fallos): aislamiento entre firmas, cambio de `org_id`, acceso vertical, auxiliar sin asignar, portal del cliente, partida doble, separación de funciones, inmutabilidad, reverso, periodo cerrado, auditoría, almacenamiento.

### Primer uso
1. Publique la app (abajo) y en Supabase → *Authentication → URL Configuration* ponga el dominio como **Site URL** y agregue `https://su-dominio/**` en *Redirect URLs*.
2. Regístrese en `/registro`, confirme el correo y cree la firma.
3. Para ser superadministrador de la plataforma, en *SQL Editor*:
   `update public.profiles set is_superadmin = true where email = 'su-correo';`

### Secretos opcionales (Edge Functions → Secrets)
- OCR/IA de PDF e imágenes: `AI_DOCUMENTS_ENABLED=true`, `ANTHROPIC_API_KEY`, opcional `AI_MODEL`. Revise antes el tratamiento de datos con el proveedor.
- Correo: `RESEND_API_KEY`, `MAIL_FROM`; desplegar `dispatch-messages` y programarlo. WhatsApp requiere un proveedor autorizado de la API de WhatsApp Business.
- `ALLOWED_ORIGIN=https://su-dominio` para restringir CORS.

## Frontend

```
cd web
./build.sh          # requiere bun; genera dist/
bun test            # pruebas de XML UBL, importes, fechas, CSV y DV del NIT
```
`dist/` es un sitio estático (incluye `_redirects` y `_headers` con CSP para Netlify). La URL y la clave publicable están en `public/config.js`.

## Pendiente o fuera de alcance
- Fechas oficiales del calendario tributario: se cargan y verifican con la fuente oficial (decreto vigente).
- Proveedor OCR/IA, correo y WhatsApp: interfaces listas, se activan con credenciales.
- Pasarela de pagos y webhooks para cobrar suscripciones.
- Integraciones directas con bancos y DIAN (no implementadas; no se afirma que existan).
- Copias de seguridad: las diarias de Supabase dependen del plan; para recuperación a un punto en el tiempo se requiere plan pago.
- Ninguna certificación de seguridad ha sido obtenida.
