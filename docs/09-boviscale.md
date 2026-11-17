# 09. BoviScale

BoviScale se describe como pesaje asistido por fotografía. La captura debe funcionar offline y el análisis quedar diferido.

## Flujo descrito
1. Capturar fotografía y metadatos.
2. Guardar imagen como `Blob` en `db.media`.
3. Registrar trabajo en `weighingAnalysisJobs`.
4. Reintentar análisis cuando vuelva la conexión.
5. Asociar el resultado al pesaje original.

**Regla:** no inventar ni asignar un peso si el análisis no se ejecutó o no devolvió un resultado válido. Capturar una imagen no equivale a completar el análisis.

La fuente identifica como pendiente un proxy seguro de IA en el backend. No se proporcionaron proveedor, endpoint, contrato ni esquema de respuesta; deben documentarse cuando estén definidos. Protege credenciales, valida archivos y permite reintentos sin duplicar análisis.
