# Documentación de la API - FarmBovi

Esta sección detalla los endpoints principales del backend de FarmBovi, incluyendo las rutas unificadas, métodos HTTP, parámetros de filtrado por rancho y requerimientos de seguridad.

---

## 🔒 Seguridad y Autenticación
- **Tipo de Autenticación:** Bearer Token (JWT).
- **Cabecera requerida:** `Authorization: Bearer <tu_token_jwt>`
- **Multi-tenancy:** Todas las peticiones validan de forma estricta que el usuario autenticado tenga permisos sobre el `IdRancho` consultado o modificado en la tabla intermedia `UsuarioRanchos`.

---

## 🐄 Módulo de Animales (Cattle)

### 1. Obtener todos los animales
Permite listar los animales. Se puede filtrar opcionalmente por un rancho específico.
- **Rutas:** 
  - `GET /api/es/animales`
  - `GET /api/en/cattle`
- **Parámetros de consulta (Query Params):**
  - `idRancho` *(opcional)*: ID numérico del rancho a consultar. Si no se envía, devuelve los animales de todos los ranchos permitidos para el usuario.
- **Respuesta Exitosa (200 OK):**
  ```json
  [
    {
      "idAnimal": 1,
      "idRancho": 1,
      "idLote": 2,
      "arete": "A-001",
      "raza": "Holstein",
      "sexo": "Hembra",
      "estado": "Activo"
    }
  ]
2. Obtener un animal por ID
Rutas:

GET /api/es/animales/{id}

GET /api/en/cattle/{id}

Parámetros de ruta:

id: ID único del animal.

Respuestas:

200 OK: Devuelve el objeto del animal.

404 Not Found: Si el animal no existe.

403 Forbidden: Si el usuario no tiene acceso al rancho de ese animal.

3. Registrar un nuevo animal
Rutas:

POST /api/es/animales

POST /api/en/cattle

Cuerpo de la petición (JSON Body):

JSON
{
  "idRancho": 1,
  "idLote": 2,
  "arete": "A-002",
  "raza": "Brangus",
  "sexo": "Macho",
  "procedencia": "Nacimiento",
  "estado": "Activo"
}
Respuestas:

201 Created: Animal registrado con éxito.

400 Bad Request: Si falta el idRancho o datos obligatorios.

409 Conflict: Si el número de arete ya existe en ese rancho.

4. Actualizar un animal
Rutas:

PUT /api/es/animales/{id}

PUT /api/en/cattle/{id}

Respuestas:

204 No Content: Actualización exitosa.

404 Not Found: Animal no encontrado.

5. Eliminar un animal
Rutas:

DELETE /api/es/animales/{id}

DELETE /api/en/cattle/{id}

Respuestas:

204 No Content: Eliminación exitosa.

409 Conflict: Si existen restricciones de relaciones de datos asociadas.