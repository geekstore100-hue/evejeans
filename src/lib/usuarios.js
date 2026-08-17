// El id de cada usuario nunca cambia: de él dependen las reglas de seguridad
// para Nelson, y las etiquetas en pantalla para las vendedoras.
// Blanca y Sofía comparten una sola cuenta de acceso (ver lib/auth.js) — elegir
// su nombre aquí es solo una etiqueta, no una verificación de identidad.
export const USUARIOS_BASE = [
  { id: 'blanca', nombreDefault: 'Blanca', rol: 'Lunes a viernes' },
  { id: 'sofia', nombreDefault: 'Sofía', rol: 'Sábados, domingos y festivos' },
  { id: 'nelson', nombreDefault: 'Nelson', rol: 'Dueño' },
];
