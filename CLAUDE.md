# Cargo 3D — Contexto y reglas (LEER SIEMPRE)

Este archivo es la **memoria del proyecto**: Claude Code lo lee al inicio de cada
sesión. Acá se anota lo importante para no repetir errores ni perder contexto.

## Reglas de trabajo (pedidas por el usuario)

1. **No inventar.** No agregar features ni "mejoras" que no se pidieron.
2. **Si no puedo ver/abrir un archivo, NO sigo.** Aviso al usuario y acordamos
   cómo conseguirlo. Nunca rellenar con suposiciones.
3. **Respetar la versión que el usuario considera buena** (ver abajo). Copiarla
   tal cual y aplicar solo la modificación pedida.
4. Hacer **una sola cosa por vez**, la que se pidió. Nada más.
5. Verificar en navegador real antes de decir que algo funciona.

## La "versión que sirve" (referencia del usuario)

- Es una copia local del usuario:
  `C:/Users/lizzi/Documents/Codex/2026-06-08/.../work/cargo-3d/`
- Es **más avanzada** que lo que estaba en el repo: tiene colocación manual con
  drag & drop, ghost con snapping/apilado/colisiones, selección de cajas,
  rotación, undo/redo, temas, CSV, informe PDF, lista de "colocadas", etc.
- Archivos recibidos del usuario y guardados en `reference/version-que-sirve/`:
  - `app.js`, `packing.js`, `viewer.js`
- **FALTAN** (necesarios para que esa versión funcione, los pedí al usuario):
  - `index.html` (referencia muchos elementos nuevos: `placedList`, `rotUI`,
    `selRotX/Y/Z`, `selX/Y/Z`, `btnExportCSV`, `btnPrintReport`,
    `btnToggleTheme`, `btnUndoLayout`, `btnRedoLayout`, `selectionEmpty/Body`…)
  - `css/styles.css`

## La modificación pedida (lo único a hacer)

Que al **arrastrar una caja desde la lista hacia el contenedor** se pueda
**rotar con R y T** (las teclas predefinidas) mientras se arrastra, antes de
soltar.

### Causa real del bug "no rotan al arrastrar"

La versión del usuario arrastra con **HTML5 Drag & Drop** (`item.draggable=true`,
eventos `dragstart`/`dragover`/`drop`). Durante un drag nativo de HTML5, el
navegador **no entrega eventos de teclado** (`keydown`) a la página, así que
`R`/`T` (que cambian `manualDragOri`) nunca se disparan durante el arrastre.

### Fix acordado

Cambiar el arrastre de la lista de **HTML5 DnD** a **pointer events**
(`pointerdown`/`pointermove`/`pointerup`), porque con pointer events el `keydown`
SÍ llega durante el arrastre (verificado en navegador). Mantener TODO lo demás
de la versión del usuario igual (ghost, snapping, apilado, validaciones,
orientaciones con `oriDims`/`rotIdx`).

## Estado / historial

- 2026-06-25: El repo `main` y la rama `claude/happy-carson-yrafih` tenían una
  versión MÍA de drag que no servía (se iba de límites, etc.). Se descartó.
- 2026-06-25: El usuario envió su versión COMPLETA (zip con index.html,
  css/styles.css, js/*). Se copió tal cual al repo, reemplazando lo anterior.
- 2026-06-25: Aplicado el ÚNICO cambio pedido — el arrastre de la lista ahora
  usa pointer events (no HTML5 DnD), así R/T rotan la caja mientras se arrastra.
  Cambios mínimos:
  - `js/app.js` renderBoxList: el item arranca el drag con `pointerdown`
    (`startManualPointerPending`) en vez de `draggable`/`dragstart`.
  - `js/viewer.js`: nuevas funciones `startManualPointerPending`,
    `updateManualGhost`, `finishManualPointerDrag`, `isOverCanvas`; listeners
    `pointermove`/`pointerup` en window; el keydown de R/T/Y refresca el ghost.
  - Verificado en Chromium: R y T rotan el ghost al arrastrar; la caja sale de
    "pendientes" y va a "colocadas"; un solo ghost; sin errores.

## Deploy

- GitHub Pages sirve la rama **`main`** → https://trulla2105.github.io/cargo-3d/
- Tras publicar, refrescar con **Ctrl+Shift+R** (la caché guarda el JS viejo).
