import { useEffect, useState } from 'react';
import { suscribirInventario } from '../lib/inventario';

// Aviso para Nelson: referencias con stock en negativo. Ahora una venta hecha
// sin internet nunca se rechaza por falta de stock (antes se perdía la venta
// entera al sincronizar); a cambio, el stock puede quedar en negativo — por
// ejemplo si se vendió sin internet algo que en el servidor ya no estaba.
// Cuando pasa, hay que contar esa referencia y corregirla en Inventario.

export default function AvisoStockNegativo() {
  const [negativas, setNegativas] = useState([]);
  const [cerrado, setCerrado] = useState('');

  useEffect(
    () =>
      suscribirInventario(
        (items) => setNegativas(items.filter((i) => !i.oculto && (i.stock || 0) < 0).sort((a, b) => a.stock - b.stock)),
        () => setNegativas([])
      ),
    []
  );

  // "Entendido" lo esconde hasta que cambie la lista.
  const firma = negativas.map((i) => `${i.id}:${i.stock}`).join('|');
  if (!negativas.length || cerrado === firma) return null;

  return (
    <div className="sn" role="status">
      <div>
        <b>Stock en negativo: {negativas.map((i) => `${i.name} (${i.stock})`).join(', ')}</b>
        <small>
          Pasa cuando se vende sin internet algo que en el sistema ya no estaba (por ejemplo, si se vendió o se ajustó desde otro aparato al mismo
          tiempo). La venta sí quedó guardada; cuenta esas referencias y corrige el stock en Mercancía → Inventario.
        </small>
      </div>
      <button onClick={() => setCerrado(firma)}>Entendido</button>
    </div>
  );
}
