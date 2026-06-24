# ⬡ Cargo Optimizer 3D

> Herramienta profesional de planificación y optimización de carga en 3D para contenedores, pallets y transporte terrestre.

[![Demo](https://img.shields.io/badge/Demo-Live-f0883e?style=flat-square)](https://trulla2105.github.io/cargo-3d/)
[![Licencia](https://img.shields.io/badge/Licencia-MIT-58a6ff?style=flat-square)](LICENSE)
[![Estado](https://img.shields.io/badge/Estado-En_desarrollo-3fb950?style=flat-square)]()

---

## ¿Qué es?

**Cargo Optimizer 3D** es una aplicación web que permite visualizar, organizar, calcular y documentar cargas reales para contenedores marítimos, pallets y camiones. Funciona completamente en el navegador, sin servidor ni instalación.

El algoritmo de packing 3D coloca automáticamente las cajas optimizando el uso del espacio, respetando restricciones de peso, fragilidad y prioridad de carga.

---

## Funcionalidades actuales (v0.1)

### Contenedores soportados
| Tipo | Dimensiones (W×D×H cm) | Carga máx |
|------|----------------------|-----------|
| Pallet Europeo | 120 × 80 × 180 | 1.000 kg |
| Pallet Standard | 120 × 100 × 180 | 1.500 kg |
| Contenedor 20' | 590 × 234 × 239 | 25.000 kg |
| Contenedor 40' | 1.203 × 234 × 239 | 27.600 kg |
| Contenedor 40HC | 1.203 × 234 × 270 | 26.580 kg |
| Camión semirremolque | 1.360 × 248 × 270 | 24.000 kg |
| Personalizado | ∞ | ∞ |

### Cajas / productos
- Nombre, SKU, cliente, dimensiones, peso
- Prioridad (alta / normal / baja)
- Fragilidad (con marcador visual rojo en el visor)
- Color personalizable

### Algoritmo de optimización
- **Extreme Points** 3D con soporte de rotaciones (hasta 6 orientaciones por caja)
- Respeta peso máximo del contenedor
- Cajas frágiles: solo orientaciones seguras
- Prioridad de carga: alta prioridad se coloca primero

### Visor 3D
- Rotación, zoom y paneo libre (OrbitControls)
- Vistas predefinidas: isométrica, frontal, lateral, superior
- Toggle grid y wireframe
- Indicador de cajas frágiles

### Estadísticas en tiempo real
- Cajas colocadas / total
- Volumen utilizado y libre (%)
- Peso total y porcentaje de carga

### Datos
- Guardar / abrir proyecto completo (JSON con posiciones)
- Exportar / importar lista de cajas (JSON)
- Captura PNG del visor

---

## Roadmap

- [x] **v0.1** — Visor 3D, packing con rotaciones, múltiples contenedores, guardar/abrir proyecto
- [ ] **v0.2** — Catálogo de productos persistente, historial de proyectos, drag & drop manual
- [ ] **v0.3** — Distribución de peso, centro de gravedad, alertas de desbalance
- [ ] **v0.4** — Informe PDF profesional (con capturas 3D multi-vista), generado con IA
- [ ] **v1.0** — Versión completa lista para uso comercial

---

## Stack técnico

- **Three.js r128** — Renderizado 3D WebGL
- **JavaScript puro** — Sin frameworks, sin dependencias de build
- **HTML + CSS** — Layout responsivo, tema dark industrial
- **Fonts** — Syne + DM Sans + DM Mono (Google Fonts)

---

## Uso local

```bash
git clone https://github.com/Trulla2105/cargo-3d.git
cd cargo-3d
# Abrir index.html en el navegador (o usar un servidor local)
npx serve .
```

> ⚠️ Three.js OrbitControls requiere servir desde un servidor HTTP (no `file://`). Usá `npx serve` o Live Server de VS Code.

---

## Estructura del proyecto

```
cargo-3d/
├── index.html          # Estructura HTML, layout
├── css/
│   └── styles.css      # Estilos, variables, tema dark
├── js/
│   ├── viewer.js       # Three.js: escena, cámara, mallas, vistas
│   ├── packing.js      # Algoritmo de packing 3D (Extreme Points)
│   └── app.js          # Lógica de UI, estado, botones, export
└── README.md
```

---

## Atajos de teclado

| Tecla | Acción |
|-------|--------|
| `Ctrl + Enter` | Optimizar carga |
| `Ctrl + S` | Guardar proyecto |
| `G` | Toggle grid |
| `W` | Toggle wireframe |

### Rotación manual de cajas

Hacé **click** sobre una caja colocada para seleccionarla (queda resaltada en naranja) y rotala "en el aire":

| Acción | Efecto |
|--------|--------|
| Arrastrar con el mouse | Rotación libre |
| `X` / `Y` / `Z` | Giro de 90° sobre cada eje |
| `0` | Restaurar orientación original |
| `Esc` / click en vacío | Deseleccionar |

---

## Autor

**Sebastián Giménez** — [@Trulla2105](https://github.com/Trulla2105)

Proyecto personal desarrollado para explorar algoritmos de bin packing 3D y visualización WebGL.

---

## Licencia

MIT — Libre para uso personal y comercial.
