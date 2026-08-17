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
    <div class="pt-line"><span>Período</span><span>${gasto.periodo || ''}</span></div>
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
