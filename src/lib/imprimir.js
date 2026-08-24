function fmt(n) {
  return '$' + Math.round(n || 0).toLocaleString('es-CO');
}

function copiaHTML(gasto, rotulo) {
  return `
    <div class="pt-center pt-small">${rotulo}</div>
    <div class="pt-center pt-big">COMPROBANTE DE PAGO</div>
    <div class="pt-center pt-small">Eve Jeans</div>
    <div class="pt-rule"></div>
    <div class="pt-line"><span>N.º</span><span><b>${gasto.consecutivoPago}</b></span></div>
    <div class="pt-line"><span>Fecha</span><span>${gasto.fecha} ${gasto.hora}</span></div>
    <div class="pt-rule"></div>
    <div class="pt-line"><span>Recibe</span><span><b>${gasto.quien || ''}</b></span></div>
    <div class="pt-line"><span>Concepto</span><span>${gasto.categoria}</span></div>
    ${gasto.periodo ? `<div class="pt-line"><span>Período</span><span>${gasto.periodo}</span></div>` : ''}
    <div class="pt-line"><span>Forma</span><span>${gasto.origen}</span></div>
    ${gasto.desc ? `<div class="pt-small">${gasto.desc}</div>` : ''}
    <div class="pt-rule"></div>
    <div class="pt-line pt-total"><span>VALOR</span><span>${fmt(gasto.monto)}</span></div>
    <div class="pt-rule"></div>
    <div class="pt-small" style="margin-top:6px">
      Declaro que recibí a satisfacción la suma indicada,
      por el concepto y período señalados.
    </div>
    <div style="margin-top:26px;border-top:1px solid #000;padding-top:3px">
      <div class="pt-center pt-small">Firma de quien recibe</div>
    </div>
    <div style="margin-top:6px" class="pt-small">C.C. ____________________</div>
    <div style="margin-top:16px;border-top:1px solid #000;padding-top:3px">
      <div class="pt-center pt-small">Firma de quien entrega</div>
    </div>
    <div class="pt-center pt-small" style="margin-top:8px">Registró: ${gasto.usuarioNombre}</div>`;
}

export function imprimirComprobantePago(gasto) {
  const area = document.getElementById('print-area');
  if (!area) return;
  area.innerHTML = `
    ${copiaHTML(gasto, '— ORIGINAL: queda con Nelson —')}
    <div style="margin:14px 0;border-top:2px dashed #000"></div>
    <div class="pt-center pt-small">✂ cortar aquí</div>
    <div style="margin:8px 0"></div>
    ${copiaHTML(gasto, '— COPIA: queda con quien recibe —')}
    <div class="pt-center pt-small" style="margin-top:8px">.</div>`;
  window.print();
}

function encabezadoTicket(num, fecha, hora, usuarioNombre) {
  return `
    <img src="/logo.png" alt="Eve Jeans" class="pt-logo" />
    <div class="pt-center pt-big">EVE JEANS</div>
    <div class="pt-rule"></div>
    <div class="pt-line"><span>N.º</span><span><b>${num}</b></span></div>
    <div class="pt-line"><span>Fecha</span><span>${fecha} ${hora}</span></div>
    <div class="pt-line"><span>Atendió</span><span>${usuarioNombre}</span></div>
    <div class="pt-rule"></div>`;
}

export function imprimirTicketVenta(venta) {
  const area = document.getElementById('print-area');
  if (!area) return;
  const lineas = venta.lineas
    .map((l) => {
      // Las prendas "por precio" no tienen nombre propio (su "nombre" es el precio,
      // ej. "$15.000"), así que en el ticket se describen de forma genérica.
      const nombre = l.tipo === 'precio' ? `Prenda de vestir REF $${l.price}` : l.name;
      return `
      <div class="pt-line"><span>${nombre}</span><span>${fmt(l.price * l.qty)}</span></div>
      <div class="pt-small">&nbsp;&nbsp;${l.qty} × ${fmt(l.price)}</div>`;
    })
    .join('');
  const pagosHTML = Object.entries(venta.pagos || {})
    .map(([m, monto]) => `<div class="pt-line"><span>${m}</span><span>${fmt(monto)}</span></div>`)
    .join('');

  area.innerHTML = `
    ${encabezadoTicket(venta.num, venta.fecha, venta.hora, venta.usuarioNombre)}
    ${lineas}
    <div class="pt-rule"></div>
    <div class="pt-line"><span>Subtotal</span><span>${fmt(venta.subtotal)}</span></div>
    ${venta.descuento ? `<div class="pt-line"><span>Descuento</span><span>-${fmt(venta.descuento)}</span></div>` : ''}
    <div class="pt-line pt-total"><span>TOTAL</span><span>${fmt(venta.total)}</span></div>
    <div class="pt-rule"></div>
    ${pagosHTML}
    <div class="pt-rule"></div>
    <div class="pt-center pt-small">Cambios hasta 8 días<br>presentando este comprobante</div>
    <div class="pt-center pt-small" style="margin-top:8px">.</div>`;
  window.print();
}

function fechaBonitaLarga(fechaStr) {
  const [y, m, d] = fechaStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function medioLineaHTML(medio, resumen, esNelson) {
  const entro = resumen.porPago[medio] || 0;
  const salioGastos = resumen.gastosMedio[medio] || 0;
  const salioCompras = resumen.comprasMedio[medio] || 0;
  if (entro === 0 && salioGastos === 0 && salioCompras === 0) return '';
  let extra = '';
  if (salioGastos > 0) extra += `<div class="pt-small">&nbsp;&nbsp;−${fmt(salioGastos)} en gastos</div>`;
  if (esNelson && salioCompras > 0) extra += `<div class="pt-small">&nbsp;&nbsp;−${fmt(salioCompras)} en compras</div>`;
  return `<div class="pt-line"><span>${medio}</span><span>${fmt(resumen.netoPorMedio[medio])}</span></div>${extra}`;
}

// Cierre del día completo, para dejar un comprobante físico de todo lo que se
// vendió, cambió, gastó y compró ese día, junto con el efectivo a entregar.
// Las compras solo se incluyen si quien imprime es Nelson (mismo criterio que en
// pantalla: es información de costos, no la ven las vendedoras).
export function imprimirCierre({ fecha, resumen, usuario, obs }) {
  const area = document.getElementById('print-area');
  if (!area) return;
  const esNelson = usuario.id === 'nelson';
  const totalPrendas = resumen.prendas.reduce((s, p) => s + p.qty, 0);

  const prendasHTML = resumen.prendas.length
    ? resumen.prendas
        .map((p) => `<div class="pt-line"><span>${p.name}</span><span>×${p.qty}</span></div>`)
        .join('')
    : `<div class="pt-small">Ninguna.</div>`;

  const cambiosHTML = resumen.cambiosLista.length
    ? resumen.cambiosLista
        .map(
          (c) => `
      <div class="pt-line"><span>Cambio ${c.hora}</span><span>${
            c.diferencia === 0 ? 'parejo' : (c.diferencia > 0 ? '+' : '−') + fmt(Math.abs(c.diferencia))
          }</span></div>
      <div class="pt-small">&nbsp;&nbsp;Entrada: ${c.devuelve.map((d) => `${d.name} ×${d.qty}`).join(', ')}</div>
      <div class="pt-small">&nbsp;&nbsp;Salida: ${c.lleva.map((d) => `${d.name} ×${d.qty}`).join(', ')}</div>`
        )
        .join('')
    : `<div class="pt-small">Ninguno.</div>`;

  const gastosHTML = resumen.gastosLista.length
    ? resumen.gastosLista
        .map(
          (g) => `
      <div class="pt-line"><span>${g.categoria}${g.quien ? ' · ' + g.quien : ''}</span><span>${fmt(g.monto)}</span></div>
      <div class="pt-small">&nbsp;&nbsp;${g.hora} · ${g.origen}</div>`
        )
        .join('')
    : `<div class="pt-small">Ninguno.</div>`;

  const comprasHTML = !esNelson
    ? ''
    : `
    <div class="pt-rule"></div>
    <div class="pt-small"><b>COMPRAS DEL DÍA</b></div>
    ${
      resumen.comprasLista.length
        ? resumen.comprasLista
            .map(
              (c) => `
      <div class="pt-line"><span>${c.proveedor || 'Sin proveedor'}</span><span>${fmt(c.totalGeneral)}</span></div>
      <div class="pt-small">&nbsp;&nbsp;${c.hora} · ${c.items.map((i) => `${i.name} ×${i.qty}`).join(', ')}</div>`
            )
            .join('')
        : `<div class="pt-small">Ninguna.</div>`
    }
    <div class="pt-line pt-total" style="margin-top:2px"><span>Total compras</span><span>${fmt(resumen.comprasTot)}</span></div>`;

  const mediosHTML = ['Efectivo', 'Datáfono', 'Nequi', 'Addi', 'PTM', 'Sistecrédito']
    .map((m) => medioLineaHTML(m, resumen, esNelson))
    .join('');

  const impresoEn = new Date().toLocaleString('es-CO', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  area.innerHTML = `
    <img src="/logo.png" alt="Eve Jeans" class="pt-logo" />
    <div class="pt-center pt-big">CIERRE DEL DÍA</div>
    <div class="pt-center pt-small">Eve Jeans</div>
    <div class="pt-rule"></div>
    <div class="pt-line"><span>Fecha</span><span><b>${fechaBonitaLarga(fecha)}</b></span></div>
    <div class="pt-line"><span>Impreso</span><span>${impresoEn}</span></div>
    <div class="pt-line"><span>Por</span><span>${usuario.nombreDefault}</span></div>
    <div class="pt-rule"></div>

    <div class="pt-small"><b>PRENDAS VENDIDAS (${totalPrendas})</b></div>
    ${prendasHTML}

    <div class="pt-rule"></div>
    <div class="pt-small"><b>CAMBIOS (${resumen.cambiosLista.length})</b></div>
    ${cambiosHTML}

    <div class="pt-rule"></div>
    <div class="pt-small"><b>GASTOS DEL DÍA</b></div>
    ${gastosHTML}
    <div class="pt-line pt-total" style="margin-top:2px"><span>Total gastos</span><span>${fmt(resumen.gastosTot)}</span></div>
    ${comprasHTML}

    <div class="pt-rule"></div>
    <div class="pt-small"><b>POR MEDIO DE PAGO</b></div>
    ${mediosHTML}

    <div class="pt-rule"></div>
    <div class="pt-line"><span>Total vendido</span><span>${fmt(resumen.totalVendido)}</span></div>
    ${
      resumen.descuentos > 0
        ? `<div class="pt-line"><span>Descuentos dados</span><span>${fmt(resumen.descuentos)}</span></div>`
        : ''
    }
    <div class="pt-line"><span>Efectivo antes de gastos</span><span>${fmt(resumen.porPago['Efectivo'] || 0)}</span></div>
    <div class="pt-rule"></div>
    <div class="pt-line pt-total"><span>EFECTIVO A ENTREGAR</span><span>${fmt(resumen.efectivoAEntregar)}</span></div>
    <div class="pt-rule"></div>

    ${
      obs
        ? `<div class="pt-small"><b>OBSERVACIONES</b></div><div class="pt-small">${obs}</div><div class="pt-rule"></div>`
        : ''
    }

    <div class="pt-center pt-small" style="margin-top:8px">.</div>`;
  window.print();
}

export function imprimirTicketCambio(cambio) {
  const area = document.getElementById('print-area');
  if (!area) return;
  const devHTML = cambio.devuelve
    .map((d) => `<div class="pt-line"><span>${d.name}</span><span>×${d.qty}</span></div>`)
    .join('');
  const llvHTML = cambio.lleva
    .map((d) => `<div class="pt-line"><span>${d.name}</span><span>×${d.qty}</span></div>`)
    .join('');

  area.innerHTML = `
    ${encabezadoTicket(cambio.num, cambio.fecha, cambio.hora, cambio.usuarioNombre)}
    <div class="pt-small">CAMBIO</div>
    <div class="pt-rule"></div>
    <div class="pt-small">DEVUELVE</div>
    ${devHTML}
    <div class="pt-small" style="margin-top:4px">SE LLEVA</div>
    ${llvHTML}
    <div class="pt-rule"></div>
    <div class="pt-line"><span>Devuelve</span><span>${fmt(cambio.valDev)}</span></div>
    <div class="pt-line"><span>Se lleva</span><span>${fmt(cambio.valLlv)}</span></div>
    <div class="pt-line pt-total"><span>${cambio.diferencia > 0 ? 'PAGA' : 'DIFERENCIA'}</span><span>${fmt(Math.abs(cambio.diferencia))}</span></div>
    ${cambio.pago ? `<div class="pt-line"><span>Forma</span><span>${cambio.pago}</span></div>` : ''}
    <div class="pt-rule"></div>
    <div class="pt-center pt-small" style="margin-top:8px">.</div>`;
  window.print();
}
