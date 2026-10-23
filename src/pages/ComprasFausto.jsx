import FacturasCompra from './FacturasCompra';

// Pantalla de compras de Fausto: la misma de facturas que usa Nelson (ver
// FacturasCompra.jsx), en modo "fausto" — solo sus propias facturas, sin
// preguntar proveedor ni de dónde sale la plata.
export default function ComprasFausto({ usuario }) {
  return <FacturasCompra usuario={usuario} modo="fausto" />;
}
