#!/bin/sh
# Hosting estático sin reglas de reescritura (p. ej. Render): copia index.html en cada ruta
# conocida para que recargar la página no dé 404. Netlify usa _redirects y no lo necesita.
set -e
cd "$(dirname "$0")/dist"
for p in ingresar registro recuperar nueva-clave portal app app/bienvenida app/clientes app/documentos app/contabilidad \
  app/conciliacion app/cartera app/calendario app/tareas app/informes app/notificaciones app/configuracion app/plataforma \
  f/contabilidad-digital f/contabilidad-digital/privacidad; do
  mkdir -p "$p" && cp index.html "$p/index.html"
done
cp index.html 404.html
echo "Rutas preparadas"
