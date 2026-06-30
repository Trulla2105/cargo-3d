# Kriger — App de escritorio

App de escritorio para el negocio **Kriger** (indumentaria): control de las dos
cajas (mostrador y fondo), ventas, gastos, pases de plata, clientes con cuenta
corriente, cierre del día y estadísticas.

Está hecha a partir del boceto `kriger.html`, respetando colores, estilo y forma
de cargar, pero ahora es una app de verdad con **base de datos SQLite guardada en
la PC** (no en el navegador ni en la nube) y **copias de seguridad automáticas**.

## ¿Dónde se guardan los datos?

- La base de datos es un archivo `kriger.sqlite` en la carpeta privada de la app
  del usuario de Windows (ej: `C:\Users\<usuario>\AppData\Roaming\Kriger`).
- Cada día se hace una copia automática en la subcarpeta `copias-de-seguridad`
  (se guardan las últimas 30).
- Desde **Configuración → Copia de seguridad** se puede guardar una copia en un
  pendrive o en Drive cuando se quiera.

## Estado actual

- Listo: pantalla **Cargar** (venta / gasto / mover) y **Movimientos**, más el
  inicio con venta del día y saldo del mostrador (la caja fondo queda tapada con
  clave opcional). Cierre, clientes y estadísticas vienen del boceto y ya
  funcionan, pero se van a revisar y pulir uno por uno.
- La base de datos está probada (`npm run test:db`).

## Para programadores (no hace falta para usar la app)

- `main.js` — proceso principal de Electron (ventana + base de datos + copias).
- `preload.js` — puente seguro entre la pantalla y la base de datos.
- `db.js` — base de datos SQLite real con `sql.js`.
- `renderer/` — la pantalla (HTML, CSS y lógica).
