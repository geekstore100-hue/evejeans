// El id de cada usuario nunca cambia: de él dependen las reglas de seguridad
// (quién puede aprobar, a quién le toca el conteo de la semana, etc).
// El nombre que se ve en pantalla sí es editable, y vive en Firestore (colección "usuarios").
export const USUARIOS_BASE = [
  { id: 'blanca', nombreDefault: 'Blanca', rol: 'Lunes a viernes' },
  { id: 'sofia', nombreDefault: 'Sofía', rol: 'Sábados, domingos y festivos' },
  { id: 'nelson', nombreDefault: 'Nelson', rol: 'Dueño' },
];

// Correo interno fijo que usa Firebase Auth por detrás. Nunca lo ve el usuario:
// ellas solo tocan su nombre y escriben el PIN.
export function emailDe(id) {
  return `${id}@evejeans.local`;
}
