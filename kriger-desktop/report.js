// report.js — arma el resumen de SOLO LECTURA para ver desde el celular.
// No modifica nada: recibe el store y devuelve los números ya calculados.

function pm(s) {
  if (typeof s === 'number') return s;
  s = String(s || '').trim().replace(/\s/g, '').replace(/\$/g, '');
  if (!s) return 0;
  const c = s.includes(','), d = s.includes('.');
  if (c && d) s = s.replace(/\./g, '').replace(',', '.');
  else if (c) s = s.replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function efecto(m) {
  if (m.t === 'venta') return { frente: m.medio === 'efectivo' ? pm(m.monto) : 0, fondo: 0 };
  if (m.t === 'pago') return { frente: m.medio === 'efectivo' ? pm(m.monto) : 0, fondo: 0 };
  if (m.t === 'gasto') return { frente: -pm(m.frente), fondo: -pm(m.fondo) };
  if (m.t === 'mover') return m.dir === 'aFondo' ? { frente: -pm(m.monto), fondo: pm(m.monto) } : { frente: pm(m.monto), fondo: -pm(m.monto) };
  return { frente: 0, fondo: 0 };
}

function saldoActual(store, caja) {
  const desde = (store.config && store.config.saldoFecha) || '';
  let s = (store.config && store.config['saldo' + (caja === 'frente' ? 'Frente' : 'Fondo')]) || 0;
  (store.movs || []).forEach(m => { if (desde && m.fecha < desde) return; s += efecto(m)[caja]; });
  return s;
}

// Venta del día = lo realmente cobrado (sin cuenta corriente + pagos).
function ventaDe(store, date) {
  return (store.movs || []).reduce((a, m) => {
    if (m.fecha !== date) return a;
    if ((m.t === 'venta' && m.medio !== 'cta corriente') || m.t === 'pago') return a + pm(m.monto);
    return a;
  }, 0);
}

function buildReport(store, date) {
  store = store || {};
  store.config = store.config || {};
  store.movs = store.movs || [];
  store.cheques = store.cheques || [];

  const movs = store.movs.filter(m => m.fecha === date);
  const ventas = movs.filter(m => m.t === 'venta');
  const efectivo = ventas.filter(v => v.medio === 'efectivo').reduce((a, v) => a + pm(v.monto), 0);
  const transf = ventas.filter(v => v.medio === 'transferencia');
  const cheques = ventas.filter(v => v.medio === 'cheque');
  const ctaCte = ventas.filter(v => v.medio === 'cta corriente');
  const pagos = movs.filter(m => m.t === 'pago');
  const pagosTot = pagos.reduce((a, p) => a + pm(p.monto), 0);
  const ventaTotal = ventas.filter(v => v.medio !== 'cta corriente').reduce((a, v) => a + pm(v.monto), 0) + pagosTot;
  const gastos = movs.filter(m => m.t === 'gasto');

  const sumEstado = e => store.cheques.filter(c => c.estado === e).reduce((a, c) => a + pm(c.monto), 0);
  const cartera = store.cheques.filter(c => c.estado === 'cartera')
    .slice().sort((a, b) => (a.vencimiento || '').localeCompare(b.vencimiento || ''))
    .map(c => ({ numero: c.numero, cliente: c.cliente, vencimiento: c.vencimiento, monto: pm(c.monto) }));

  const fondoMovs = store.movs.filter(m => efecto(m).fondo !== 0)
    .slice().sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''))
    .slice(0, 50)
    .map(m => ({
      fecha: m.fecha,
      desc: m.t === 'gasto' ? ('Gasto: ' + (m.concepto || '')) : (m.dir === 'aFondo' ? 'Vino del mostrador' : 'Pasó al mostrador'),
      ef: efecto(m).fondo,
      cajero: m.cajero || ''
    }));

  return {
    fecha: date,
    ventaHoy: ventaDe(store, date),
    saldoFrente: saldoActual(store, 'frente'),
    saldoFondo: saldoActual(store, 'fondo'),
    cierre: {
      ventaTotal,
      efectivo,
      transferencias: transf.map(v => ({ cliente: v.cliente || '', monto: pm(v.monto) })),
      transfTot: transf.reduce((a, v) => a + pm(v.monto), 0),
      cheques: cheques.map(v => ({ cliente: v.cliente || '', monto: pm(v.monto) })),
      chequesTot: cheques.reduce((a, v) => a + pm(v.monto), 0),
      cobradoCC: pagosTot,
      entregadoCC: ctaCte.reduce((a, v) => a + pm(v.monto), 0),
      gastos: gastos.map(g => ({ concepto: g.concepto || '', monto: pm(g.frente) + pm(g.fondo) })),
      gastosTot: gastos.reduce((a, g) => a + pm(g.frente) + pm(g.fondo), 0)
    },
    cheques: {
      enCartera: sumEstado('cartera'),
      cobrados: sumEstado('cobrado'),
      entregados: sumEstado('entregado'),
      lista: cartera
    },
    fondo: { saldo: saldoActual(store, 'fondo'), movs: fondoMovs }
  };
}

module.exports = { buildReport };
