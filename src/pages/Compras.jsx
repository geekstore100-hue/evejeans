import FacturasCompra from './FacturasCompra';

// Pantalla de compras de Nelson: la misma de facturas que usa Fausto (ver
// FacturasCompra.jsx), en modo "nelson" — ve y puede corregir las facturas de
// todos, y en las suyas dice el proveedor y de dónde sale la plata.
export default function Compras({ usuario }) {
  return <FacturasCompra usuario={usuario} modo="nelson" />;
}
