# Eve Jeans · Punto de venta y control de inventario

Proyecto en Firebase (`evejeans`). Construido en fases:

- **Fase 1** (en progreso): estructura del proyecto, login real con PIN por Firebase Auth,
  base para venta e inventario en tiempo real.
- **Fase 2**: cambios, gastos, comisiones.
- **Fase 3**: sobres/recogidas, conteos de inventario con festivos colombianos,
  panel de administración completo.

## Cómo entrar

- Se elige el nombre (Blanca / Sofía) y se escribe un PIN de 6 dígitos.
- Nelson entra por el enlace "Entrar como Nelson (Administración)".
- Por dentro, cada persona tiene una cuenta fija en Firebase Authentication
  (correo interno tipo `blanca@evejeans.local`, nunca visible para el usuario) y su PIN
  es la contraseña de esa cuenta.

## Pendiente para terminar de conectar todo

1. Crear las 3 cuentas en **Firebase Console → Authentication → Users → Add user**:
   - `blanca@evejeans.local`
   - `sofia@evejeans.local`
   - `nelson@evejeans.local`
   con un PIN de 6 dígitos como contraseña para cada una.
2. Conectar este repositorio a **Firebase Hosting** vía GitHub Actions
   (se agrega automáticamente el workflow y el secreto necesario).
3. Firestore ya tiene reglas de seguridad, pero **bloqueando todo** hasta que
   se construyan las colecciones reales (Fase 1 avanzada / Fase 2).

## Desarrollo local

```
npm install
npm run dev
```
