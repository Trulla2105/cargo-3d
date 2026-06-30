// ============================================================================
// Kriger — "buzón" para ver el resumen desde el celular (Cloudflare Worker).
// La PC deja acá el último resumen (POST /push) y el celular lo ve (GET /).
// Solo lectura. Protegido con dos claves (una para escribir, otra para leer).
// Las claves las completa la app automáticamente al copiar este código.
// ============================================================================

const WRITE_KEY = "__WRITEKEY__";
const READ_KEY = "__READKEY__";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // La PC publica el resumen acá.
    if (request.method === "POST" && url.pathname === "/push") {
      if ((url.searchParams.get("key") || "") !== WRITE_KEY) {
        return new Response("clave incorrecta", { status: 401 });
      }
      const body = await request.text();
      await env.KRIGER.put("snapshot", body);
      return new Response("ok");
    }

    // El celular pide los datos (con la clave de lectura).
    if (url.pathname === "/data") {
      if ((url.searchParams.get("k") || "") !== READ_KEY) {
        return new Response(JSON.stringify({ error: "clave" }), { status: 401, headers: { "content-type": "application/json" } });
      }
      const s = (await env.KRIGER.get("snapshot")) || "{}";
      return new Response(s, { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
    }

    // Cualquier otra cosa: la página de solo lectura.
    return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } });
  }
};

const PAGE = `<!DOCTYPE html>
<html lang="es-AR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Kriger">
<title>Kriger</title>
<style>
  :root{--ink:#1B1B1A;--bg:#EDEDE8;--card:#fff;--line:#DBDBD3;--line-soft:#EEEEE8;--muted:#7A7A72;--hi:#C9F03F;--pen:#27347A;--bad:#C0392B;--ok:#2E7D32}
  *{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
  body{background:var(--bg);color:var(--ink);font-family:"Segoe UI",system-ui,-apple-system,sans-serif;line-height:1.35;padding-bottom:40px}
  .wrap{max-width:560px;margin:0 auto;padding:14px}
  .bar{position:sticky;top:0;z-index:5;background:var(--bg);border-bottom:1px solid var(--line)}
  .barin{max-width:560px;margin:0 auto;padding:12px 14px;display:flex;align-items:center;gap:8px}
  .brand{font-weight:700;font-size:18px;letter-spacing:.14em;text-transform:uppercase;display:flex;align-items:center;gap:7px}
  .brand .sq{width:11px;height:11px;background:var(--hi);transform:skewX(-9deg)}
  .ro{margin-left:auto;font-size:11px;color:var(--muted);border:1px solid var(--line);border-radius:20px;padding:3px 9px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:15px;margin-top:12px}
  .lbl{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);font-weight:600}
  .big{font-size:30px;font-weight:700;font-variant-numeric:tabular-nums;position:relative}
  .swipe{position:absolute;left:0;width:120px;bottom:3px;height:14px;background:var(--hi);transform:skewX(-9deg);z-index:0}
  .big span{position:relative;z-index:1}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}
  .box{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px 13px}
  .box .amt{font-size:21px;font-weight:700;font-variant-numeric:tabular-nums}
  .ln{display:flex;justify-content:space-between;align-items:baseline;padding:5px 0;font-size:14px}
  .ln .v{font-weight:600;font-variant-numeric:tabular-nums}
  .ln.sub{color:var(--muted);font-size:13px;padding-left:10px}
  .rule{height:1px;background:var(--line-soft);margin:7px 0}
  table{width:100%;border-collapse:collapse;font-size:13.5px}
  th{text-align:left;font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-weight:600;padding:7px 5px;border-bottom:1px solid var(--line)}
  td{padding:9px 5px;border-bottom:1px solid var(--line-soft)}
  td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
  .empty{color:var(--muted);font-size:13px;padding:16px;text-align:center}
  .muted{color:var(--muted)}
  .err{color:var(--bad);font-size:14px;text-align:center;padding:30px 16px}
  .updated{text-align:center;font-size:11px;color:var(--muted);margin-top:14px}
</style>
</head>
<body>
<div class="bar"><div class="barin">
  <span class="brand"><span class="sq"></span>Kriger</span>
  <span class="ro">Solo lectura</span>
</div></div>
<div class="wrap" id="app"><div class="empty">Cargando…</div></div>
<script>
  function qs(n){var m=location.search.match(new RegExp('[?&]'+n+'=([^&]*)'));return m?decodeURIComponent(m[1]):'';}
  var KEY=qs('k');
  function fmt(n){return '$ '+(Number(n)||0).toLocaleString('es-AR',{minimumFractionDigits:0,maximumFractionDigits:2});}
  function fDate(s){if(!s)return '—';var p=String(s).split('-');return p.length===3?p[2]+'/'+p[1]+'/'+p[0]:s;}
  function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
  function ln(l,v,strong){return '<div class="ln"><span'+(strong?' style="font-weight:700"':'')+'>'+esc(l)+'</span><span class="v"'+(strong?' style="font-size:17px"':'')+'>'+v+'</span></div>';}
  function lnSub(l,v){return '<div class="ln sub"><span>'+esc(l)+'</span><span class="v">'+v+'</span></div>';}
  function load(){
    fetch('/data?k='+encodeURIComponent(KEY)).then(function(r){
      if(r.status===401){document.getElementById('app').innerHTML='<div class="err">Enlace inválido o sin clave.</div>';return null;}
      return r.json();
    }).then(function(d){ if(d) render(d); })
    .catch(function(){document.getElementById('app').innerHTML='<div class="err">No se pudo cargar. Probá de nuevo en un momento.</div>';});
  }
  function render(d){
    if(!d || !d.fecha){document.getElementById('app').innerHTML='<div class="empty">Todavía no hay datos. Abrí Kriger en la PC y cargá un movimiento.</div>';return;}
    var c=d.cierre||{},ch=d.cheques||{},fo=d.fondo||{},h='';
    h+='<div class="card"><div class="lbl">Venta de hoy</div><div class="big"><span class="swipe"></span><span>'+fmt(d.ventaHoy)+'</span></div><div class="muted" style="font-size:12px;margin-top:6px">'+fDate(d.fecha)+'</div></div>';
    h+='<div class="grid2"><div class="box"><div class="lbl">Caja mostrador</div><div class="amt">'+fmt(d.saldoFrente)+'</div></div><div class="box"><div class="lbl">Caja fondo</div><div class="amt">'+fmt(d.saldoFondo)+'</div></div></div>';
    h+='<div class="card"><div class="lbl" style="margin-bottom:8px">Cierre del día</div>';
    h+=ln('Venta del día',fmt(c.ventaTotal),true)+'<div class="rule"></div>';
    h+=ln('Efectivo',fmt(c.efectivo))+ln('Transferencias',fmt(c.transfTot));
    (c.transferencias||[]).forEach(function(t){h+=lnSub(t.cliente||'sin nombre',fmt(t.monto));});
    h+=ln('Cheques',fmt(c.chequesTot));
    (c.cheques||[]).forEach(function(t){h+=lnSub(t.cliente||'sin nombre',fmt(t.monto));});
    if(c.cobradoCC)h+=ln('Cobrado de cuenta corriente',fmt(c.cobradoCC));
    if(c.entregadoCC)h+=ln('Entregado a cta cte (a cobrar)',fmt(c.entregadoCC));
    if(c.gastosTot){h+='<div class="rule"></div>'+ln('Gastos del día',fmt(c.gastosTot));(c.gastos||[]).forEach(function(g){h+=lnSub(g.concepto,fmt(g.monto));});}
    h+='</div>';
    h+='<div class="card"><div class="lbl" style="margin-bottom:6px">Cheques en cartera</div><div class="ln"><span class="muted" style="font-size:12px">En cartera</span><span class="v">'+fmt(ch.enCartera)+'</span></div>';
    if((ch.lista||[]).length){h+='<table><thead><tr><th>N°</th><th>Cliente</th><th>Vence</th><th class="num">Monto</th></tr></thead><tbody>';
      ch.lista.forEach(function(x){h+='<tr><td><b>'+(esc(x.numero)||'—')+'</b></td><td>'+(esc(x.cliente)||'—')+'</td><td>'+fDate(x.vencimiento)+'</td><td class="num">'+fmt(x.monto)+'</td></tr>';});
      h+='</tbody></table>';}else{h+='<div class="empty">No hay cheques en cartera.</div>';}
    h+='</div>';
    h+='<div class="card"><div class="lbl">Caja fondo</div><div class="big" style="font-size:24px;margin-top:4px"><span>'+fmt(fo.saldo)+'</span></div>';
    if((fo.movs||[]).length){h+='<table style="margin-top:8px"><tbody>';
      fo.movs.forEach(function(m){h+='<tr><td>'+esc(m.desc)+'<div class="muted" style="font-size:11px">'+fDate(m.fecha)+'</div></td><td class="num" style="color:'+(m.ef<0?'var(--bad)':'var(--ok)')+'">'+(m.ef<0?'−':'+')+fmt(Math.abs(m.ef))+'</td></tr>';});
      h+='</tbody></table>';}else{h+='<div class="empty">Sin movimientos.</div>';}
    h+='</div>';
    h+='<div class="updated">Actualizado '+new Date().toLocaleTimeString('es-AR')+' · se refresca solo</div>';
    document.getElementById('app').innerHTML=h;
  }
  load();
  setInterval(load,20000);
</script>
</body>
</html>`;
