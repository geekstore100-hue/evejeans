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
    <div class="pt-center pt-big">EVE JEANS</div>
    <div class="pt-center pt-small">Comprobante interno · no es factura</div>
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
    .map(
      (l) => `
      <div class="pt-line"><span>${l.name}</span><span>${fmt(l.price * l.qty)}</span></div>
      <div class="pt-small">&nbsp;&nbsp;${l.qty} × ${fmt(l.price)}</div>`
    )
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
    <div class="pt-center pt-small" style="margin-top:6px">Si no le entregan este comprobante,<br>reclámelo.</div>
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
