# 11. Seguridad

La documentación compartida no demuestra un modelo de seguridad completo. Menciona validaciones DTO y hash de contraseñas, pero también identifica autenticación, autorización y aislamiento por rancho como pendientes.

## Verificaciones necesarias
- Contraseñas con hash adecuado, nunca texto plano.
- Autenticación y autorización en servidor.
- Aislamiento por rancho en cada lectura y escritura.
- Validación de DTOs y límites de archivos.
- Secretos fuera del repositorio.
- HTTPS en despliegues.
- Gestión de expiración, renovación y revocación de sesión.
- Idempotencia y autorización de operaciones de sincronización.
- Registros sin tokens ni datos sensibles.

IndexedDB no es un almacén secreto: el usuario del dispositivo puede inspeccionar datos locales. Evalúa minimización de datos y protección del dispositivo.

## Checklist de producción
- [ ] Autenticación y autorización probadas.
- [ ] Aislamiento entre ranchos probado.
- [ ] HTTPS obligatorio.
- [ ] Secretos fuera del repositorio.
- [ ] Validación de entradas y archivos.
- [ ] Sincronización idempotente.
- [ ] Respaldo y recuperación definidos.
- [ ] Revisión de dependencias y pruebas de seguridad.
