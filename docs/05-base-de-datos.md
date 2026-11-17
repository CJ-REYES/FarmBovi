# 05. Base de datos

La persistencia central declarada es MySQL 8.0+ mediante Entity Framework Core 10 y `FarmDbContext`. El README menciona diez entidades y migraciones versionadas.

No se proporcionó el modelo completo ni las migraciones; por tanto, este documento no inventa tablas, columnas o relaciones. Para completarlo desde el código registra por entidad: tabla, PK, FK, cardinalidades, índices, restricciones, campos de auditoría y política de borrado lógico.

La bitácora menciona `VersionRegistro` y `EliminadoEn`; confirma cómo se incrementan y filtran. Revisa SQL de cada migración, respalda antes de producción y define reversión.

Dexie/IndexedDB (`FarmBoviLocalDB`) es persistencia local del navegador y no sustituye MySQL. La sincronización define cómo se intercambian cambios entre ambas.
