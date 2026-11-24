using System.Security.Claims;
using FarmBovi.Api.Data;
using FarmBovi.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace FarmBovi.Api.Services;

public sealed class FarmDomainValidationService(FarmDbContext db)
{
    private static readonly HashSet<string> TiposMovimientoPermitidos = new(StringComparer.OrdinalIgnoreCase)
    {
        "Alta",
        "CambioInterno",
        "Cambio interno",
        "Traslado",
        "Venta",
        "Baja"
    };

    /// <summary>
    /// Resuelve IdAutor priorizando la identidad autenticada (ClaimsPrincipal) cuando exista,
    /// sin confiar en el valor enviado por el cliente. Mientras la autenticación siga pendiente
    /// en el contrato de API, verifica que el IdAutor exista en Usuario.
    /// </summary>
    public async Task<(Guid AuthorId, string? Error)> ResolveAuthorAsync(
        ClaimsPrincipal? user, Guid clientProvidedAuthorId, CancellationToken ct)
    {
        Guid resolvedId = Guid.Empty;

        if (user?.Identity?.IsAuthenticated == true)
        {
            var claimValue = user.FindFirstValue(ClaimTypes.NameIdentifier)
                ?? user.FindFirstValue("sub")
                ?? user.FindFirstValue("idUsuario");

            if (!Guid.TryParse(claimValue, out resolvedId) || resolvedId == Guid.Empty)
                return (Guid.Empty, "La identidad autenticada no contiene un identificador de usuario válido.");
        }
        else
        {
            if (clientProvidedAuthorId == Guid.Empty)
                return (Guid.Empty, "El identificador de autor (idAutor) es obligatorio.");

            resolvedId = clientProvidedAuthorId;
        }

        var authorExists = await db.Usuarios.AsNoTracking()
            .AnyAsync(u => u.IdUsuario == resolvedId, ct);

        if (!authorExists)
            return (Guid.Empty, "El usuario autor especificado no existe.");

        return (resolvedId, null);
    }

    public async Task<string?> ValidateAnimalAsync(Animal animal, Guid? excludeAnimalId, CancellationToken ct)
    {
        if (animal.IdRancho == Guid.Empty)
            return "El rancho del animal (idRancho) es obligatorio.";

        if (string.IsNullOrWhiteSpace(animal.Arete) ||
            string.IsNullOrWhiteSpace(animal.Raza) ||
            string.IsNullOrWhiteSpace(animal.Sexo) ||
            string.IsNullOrWhiteSpace(animal.Procedencia) ||
            string.IsNullOrWhiteSpace(animal.Estado))
        {
            return "Arete, raza, sexo, procedencia y estado del animal son obligatorios.";
        }

        var ranchoExists = await db.Ranchos.AsNoTracking()
            .AnyAsync(r => r.IdRancho == animal.IdRancho && r.EliminadoEn == null, ct);
        if (!ranchoExists)
            return "El rancho especificado no existe o está eliminado.";

        var normalizedArete = animal.Arete.Trim();
        var duplicateArete = await db.Animales.AsNoTracking()
            .AnyAsync(a => a.IdRancho == animal.IdRancho
                        && a.Arete == normalizedArete
                        && a.EliminadoEn == null
                        && (!excludeAnimalId.HasValue || a.IdAnimal != excludeAnimalId.Value), ct);
        if (duplicateArete)
            return "Ya existe un animal activo con ese arete en el rancho.";

        if (animal.IdLote.HasValue)
        {
            if (animal.IdLote.Value == Guid.Empty)
                return "El identificador de lote (idLote) no es válido.";

            var lote = await db.Lotes.AsNoTracking()
                .FirstOrDefaultAsync(l => l.IdLote == animal.IdLote.Value && l.EliminadoEn == null, ct);
            if (lote is null)
                return "El lote especificado no existe o está eliminado.";

            if (lote.IdRancho != animal.IdRancho)
                return "El lote asignado debe pertenecer al mismo rancho del animal.";
        }

        return null;
    }

    public async Task<string?> ValidateAlimentacionAsync(
        Guid? idAnimal, Guid? idLote, decimal cantidad, DateTime inicio, DateTime? fin, CancellationToken ct)
    {
        // Regla 05: XOR(idAnimal, idLote). Exactamente uno debe estar informado.
        if (idAnimal.HasValue == idLote.HasValue)
            return "Debe informarse exactamente uno entre idAnimal e idLote (son mutuamente excluyentes).";

        if (cantidad <= 0)
            return "La cantidad de alimentación debe ser mayor que cero.";

        if (fin.HasValue && fin.Value < inicio)
            return "La fecha de fin no puede ser anterior a la fecha de inicio.";

        if (idAnimal.HasValue)
        {
            if (idAnimal.Value == Guid.Empty)
                return "El identificador de animal no es válido.";

            var animalExists = await db.Animales.AsNoTracking()
                .AnyAsync(a => a.IdAnimal == idAnimal.Value && a.EliminadoEn == null, ct);
            if (!animalExists)
                return "El animal especificado no existe o está eliminado.";
        }

        if (idLote.HasValue)
        {
            if (idLote.Value == Guid.Empty)
                return "El identificador de lote no es válido.";

            var loteExists = await db.Lotes.AsNoTracking()
                .AnyAsync(l => l.IdLote == idLote.Value && l.EliminadoEn == null, ct);
            if (!loteExists)
                return "El lote especificado no existe o está eliminado.";
        }

        return null;
    }

    public async Task<(Animal? Animal, string? Error)> ValidateAndPrepareMovimientoAsync(
        MovimientoAnimal movimiento, CancellationToken ct)
    {
        if (movimiento.IdAnimal == Guid.Empty)
            return (null, "El identificador del animal (idAnimal) es obligatorio.");

        if (string.IsNullOrWhiteSpace(movimiento.Tipo) || !TiposMovimientoPermitidos.Contains(movimiento.Tipo.Trim()))
            return (null, "El tipo de movimiento debe ser Alta, CambioInterno, Traslado, Venta o Baja.");

        var animal = await db.Animales.FirstOrDefaultAsync(a => a.IdAnimal == movimiento.IdAnimal && a.EliminadoEn == null, ct);
        if (animal is null)
            return (null, "El animal especificado no existe o está eliminado.");

        if (movimiento.IdLoteOrigen.HasValue && movimiento.IdLoteDestino.HasValue &&
            movimiento.IdLoteOrigen.Value == movimiento.IdLoteDestino.Value)
        {
            return (null, "El lote de origen y el lote de destino no pueden ser iguales.");
        }

        if (movimiento.IdLoteOrigen.HasValue)
        {
            var origen = await db.Lotes.AsNoTracking()
                .FirstOrDefaultAsync(l => l.IdLote == movimiento.IdLoteOrigen.Value && l.EliminadoEn == null, ct);
            if (origen is null)
                return (null, "El lote de origen especificado no existe o está eliminado.");
            if (origen.IdRancho != animal.IdRancho)
                return (null, "El lote de origen debe pertenecer al mismo rancho del animal.");
        }

        if (movimiento.IdLoteDestino.HasValue)
        {
            var destino = await db.Lotes.AsNoTracking()
                .FirstOrDefaultAsync(l => l.IdLote == movimiento.IdLoteDestino.Value && l.EliminadoEn == null, ct);
            if (destino is null)
                return (null, "El lote de destino especificado no existe o está eliminado.");

            var tipoNorm = movimiento.Tipo.Trim();
            if ((tipoNorm.Equals("Alta", StringComparison.OrdinalIgnoreCase) ||
                 tipoNorm.Equals("CambioInterno", StringComparison.OrdinalIgnoreCase) ||
                 tipoNorm.Equals("Cambio interno", StringComparison.OrdinalIgnoreCase)) &&
                destino.IdRancho != animal.IdRancho)
            {
                return (null, "En altas o cambios internos, el lote de destino debe pertenecer al mismo rancho del animal.");
            }
        }

        return (animal, null);
    }

    public async Task<string?> ValidateEventoSanitarioAsync(EventoSanitario item, CancellationToken ct)
    {
        if (item.IdAnimal == Guid.Empty)
            return "El identificador del animal (idAnimal) es obligatorio.";

        if (string.IsNullOrWhiteSpace(item.Tipo) || string.IsNullOrWhiteSpace(item.Responsable))
            return "El tipo y el responsable del evento sanitario son obligatorios.";

        var animalExists = await db.Animales.AsNoTracking()
            .AnyAsync(a => a.IdAnimal == item.IdAnimal && a.EliminadoEn == null, ct);
        if (!animalExists)
            return "El animal especificado no existe o está eliminado.";

        return null;
    }

    public async Task<string?> ValidateTratamientoAsync(Tratamiento item, CancellationToken ct)
    {
        if (item.IdEventoSanitario == Guid.Empty)
            return "El identificador del evento sanitario (idEventoSanitario) es obligatorio.";

        if (item.Dosis <= 0)
            return "La dosis del tratamiento debe ser mayor que cero.";

        if (item.FechaFin.HasValue && item.FechaFin.Value < item.FechaInicio)
            return "La fecha de fin no puede ser anterior a la fecha de inicio.";

        if (string.IsNullOrWhiteSpace(item.Producto) ||
            string.IsNullOrWhiteSpace(item.UnidadDosis) ||
            string.IsNullOrWhiteSpace(item.Frecuencia) ||
            string.IsNullOrWhiteSpace(item.Responsable) ||
            string.IsNullOrWhiteSpace(item.Estado))
        {
            return "Producto, unidadDosis, frecuencia, responsable y estado del tratamiento son obligatorios.";
        }

        var eventoExists = await db.EventosSanitarios.AsNoTracking()
            .AnyAsync(e => e.IdEventoSanitario == item.IdEventoSanitario && e.EliminadoEn == null, ct);
        if (!eventoExists)
            return "El evento sanitario relacionado no existe o está eliminado.";

        return null;
    }

    public async Task<string?> ValidateRecordatorioAsync(Recordatorio item, CancellationToken ct)
    {
        if (item.IdRancho == Guid.Empty)
            return "El identificador del rancho (idRancho) es obligatorio.";

        if (string.IsNullOrWhiteSpace(item.Tipo) ||
            string.IsNullOrWhiteSpace(item.Descripcion) ||
            string.IsNullOrWhiteSpace(item.Estado))
        {
            return "Tipo, descripción y estado del recordatorio son obligatorios.";
        }

        // Regla 12: Recordatorio puede ser general del rancho, individual o por lote; animal y lote son excluyentes.
        if (item.IdAnimal.HasValue && item.IdLote.HasValue)
            return "El recordatorio puede ser general del rancho, individual o por lote; animal y lote son excluyentes.";

        var ranchoExists = await db.Ranchos.AsNoTracking()
            .AnyAsync(r => r.IdRancho == item.IdRancho && r.EliminadoEn == null, ct);
        if (!ranchoExists)
            return "El rancho especificado no existe o está eliminado.";

        if (item.IdAnimal.HasValue)
        {
            var animal = await db.Animales.AsNoTracking()
                .FirstOrDefaultAsync(a => a.IdAnimal == item.IdAnimal.Value && a.EliminadoEn == null, ct);
            if (animal is null)
                return "El animal especificado no existe o está eliminado.";
            if (animal.IdRancho != item.IdRancho)
                return "El animal del recordatorio debe pertenecer al rancho indicado.";
        }

        if (item.IdLote.HasValue)
        {
            var lote = await db.Lotes.AsNoTracking()
                .FirstOrDefaultAsync(l => l.IdLote == item.IdLote.Value && l.EliminadoEn == null, ct);
            if (lote is null)
                return "El lote especificado no existe o está eliminado.";
            if (lote.IdRancho != item.IdRancho)
                return "El lote del recordatorio debe pertenecer al rancho indicado.";
        }

        if (item.IdResponsable.HasValue)
        {
            var respBelongsToRanch = await (from ur in db.UsuarioRanchos.AsNoTracking()
                                            join u in db.Usuarios.AsNoTracking() on ur.IdUsuario equals u.IdUsuario
                                            where ur.IdUsuario == item.IdResponsable.Value &&
                                                  ur.IdRancho == item.IdRancho &&
                                                  ur.FechaBaja == null &&
                                                  ur.Estado.ToLower() == "activo" &&
                                                  u.Estado.ToLower() == "activo"
                                            select ur.IdUsuarioRancho).AnyAsync(ct);
            if (!respBelongsToRanch)
                return "El usuario responsable especificado no existe, está inactivo o no pertenece al rancho indicado.";
        }

        if (item.IdTratamiento.HasValue)
        {
            if (item.IdLote.HasValue)
                return "Un recordatorio vinculado a un tratamiento individual no puede asignarse a un lote.";

            var tratamiento = await db.Tratamientos.AsNoTracking()
                .FirstOrDefaultAsync(t => t.IdTratamiento == item.IdTratamiento.Value && t.EliminadoEn == null, ct);
            if (tratamiento is null)
                return "El tratamiento vinculado no existe o está eliminado.";

            var evento = await db.EventosSanitarios.AsNoTracking()
                .FirstOrDefaultAsync(e => e.IdEventoSanitario == tratamiento.IdEventoSanitario && e.EliminadoEn == null, ct);
            if (evento is null)
                return "El evento sanitario del tratamiento vinculado no existe o está eliminado.";

            if (item.IdAnimal.HasValue && item.IdAnimal.Value != evento.IdAnimal)
                return "El tratamiento debe corresponder al animal indicado en el recordatorio.";

            var animalEvento = await db.Animales.AsNoTracking()
                .FirstOrDefaultAsync(a => a.IdAnimal == evento.IdAnimal && a.EliminadoEn == null, ct);
            if (animalEvento is null)
                return "El animal del tratamiento vinculado no existe o está eliminado.";
            if (animalEvento.IdRancho != item.IdRancho)
                return "El tratamiento vinculado pertenece a un animal de otro rancho.";
        }

        return null;
    }

    // Regla 14: Pesaje.pesoRealKg > 0 proviene de báscula y nunca se sustituye con EstimacionPeso.
    public static string? ValidatePesaje(decimal pesoRealKg) =>
        pesoRealKg <= 0
            ? "El peso real de báscula (pesoRealKg) debe ser mayor que cero."
            : null;

    private static readonly HashSet<string> SexosMachoRepro = new(StringComparer.OrdinalIgnoreCase)
    {
        "macho", "masculino", "m", "male"
    };

    private static readonly HashSet<string> SexosHembraRepro = new(StringComparer.OrdinalIgnoreCase)
    {
        "hembra", "femenino", "h", "f", "female"
    };

    private static readonly HashSet<string> SexosDesconocidosRepro = new(StringComparer.OrdinalIgnoreCase)
    {
        "desconocido", "desconocida", "unknown", "nd", "n/a", "indefinido", "indeterminado", "sin especificar"
    };

    private static bool IsMaleSex(string? sexo) =>
        !string.IsNullOrWhiteSpace(sexo) && SexosMachoRepro.Contains(sexo.Trim());

    private static bool IsFemaleSex(string? sexo) =>
        !string.IsNullOrWhiteSpace(sexo) && SexosHembraRepro.Contains(sexo.Trim());

    private static bool IsUnknownSex(string? sexo) =>
        string.IsNullOrWhiteSpace(sexo) || SexosDesconocidosRepro.Contains(sexo.Trim());

    /// <summary>
    /// Identifica eventos reproductivos que biológicamente corresponden de forma exclusiva a hembras
    /// (detección de celo, inseminación, diagnóstico/confirmación de gestación, parto, pérdida gestacional, secado).
    /// </summary>
    public static bool IsFemaleOnlyReproductionEvent(string? tipo)
    {
        if (string.IsNullOrWhiteSpace(tipo)) return false;
        var t = tipo.Trim().ToLowerInvariant();
        return t.Contains("celo", StringComparison.Ordinal) ||
               t.Contains("inseminaci", StringComparison.Ordinal) ||
               t.Contains("palpaci", StringComparison.Ordinal) ||
               t.Contains("diagnóstico de gestaci", StringComparison.Ordinal) ||
               t.Contains("diagnostico de gestaci", StringComparison.Ordinal) ||
               t.Contains("gestaci", StringComparison.Ordinal) ||
               t.Contains("preñez", StringComparison.Ordinal) ||
               t.Contains("prenez", StringComparison.Ordinal) ||
               t.Contains("parto", StringComparison.Ordinal) ||
               t.Contains("aborto", StringComparison.Ordinal) ||
               t.Contains("pérdida gestacional", StringComparison.Ordinal) ||
               t.Contains("perdida gestacional", StringComparison.Ordinal) ||
               t.Contains("secado", StringComparison.Ordinal);
    }

    public static bool IsCalvingEvent(string? tipo)
    {
        if (string.IsNullOrWhiteSpace(tipo)) return false;
        var t = tipo.Trim().ToLowerInvariant();
        return t.Equals("parto", StringComparison.Ordinal) ||
               t.StartsWith("parto ", StringComparison.Ordinal);
    }

    /// <summary>
    /// Valida un evento reproductivo asegurando coherencia biológica (sexo/tipo), pertenencia de
    /// animales al mismo rancho, validez del semental y coherencia cronológica de fechas.
    /// </summary>
    public async Task<string?> ValidateEventoReproductivoAsync(
        EventoReproductivo item,
        Guid? excludeEventId,
        CancellationToken ct)
    {
        if (item.IdAnimal == Guid.Empty)
            return "El identificador del animal (idAnimal) es obligatorio.";

        if (string.IsNullOrWhiteSpace(item.Tipo))
            return "El tipo de evento reproductivo (tipo) es obligatorio.";

        var normalizedTipo = item.Tipo.Trim();
        if (normalizedTipo.Length > 60)
            return "El tipo de evento reproductivo no puede exceder 60 caracteres.";

        if (item.Resultado is not null && item.Resultado.Trim().Length > 120)
            return "El resultado del evento reproductivo no puede exceder 120 caracteres.";

        if (item.Observaciones is not null && item.Observaciones.Trim().Length > 1000)
            return "Las observaciones del evento reproductivo no pueden exceder 1000 caracteres.";

        if (item.Fecha == default)
            return "La fecha del evento reproductivo es obligatoria.";

        var fechaUtc = item.Fecha.Kind switch
        {
            DateTimeKind.Utc => item.Fecha,
            DateTimeKind.Local => item.Fecha.ToUniversalTime(),
            _ => DateTime.SpecifyKind(item.Fecha, DateTimeKind.Utc)
        };

        if (fechaUtc > DateTime.UtcNow.AddMinutes(10))
            return "La fecha del evento reproductivo no puede estar en el futuro.";

        var animal = await db.Animales.AsNoTracking()
            .FirstOrDefaultAsync(a => a.IdAnimal == item.IdAnimal && a.EliminadoEn == null, ct);
        if (animal is null)
            return "El animal especificado no existe o está eliminado.";

        if (IsFemaleOnlyReproductionEvent(normalizedTipo) && IsMaleSex(animal.Sexo))
            return $"El evento reproductivo '{normalizedTipo}' aplica únicamente a hembras; el animal seleccionado es de sexo {animal.Sexo}.";

        if (animal.FechaNacimiento.HasValue && fechaUtc.Date < animal.FechaNacimiento.Value.Date)
            return "La fecha del evento reproductivo no puede ser anterior a la fecha de nacimiento del animal.";

        if (animal.FechaSalida.HasValue && fechaUtc.Date > animal.FechaSalida.Value.Date)
            return "La fecha del evento reproductivo no puede ser posterior a la fecha de salida del animal.";

        if (item.IdSemental.HasValue)
        {
            if (item.IdSemental.Value == Guid.Empty)
                return "El identificador del semental (idSemental) no es válido.";

            if (item.IdSemental.Value == item.IdAnimal)
                return "Un animal no puede asociarse como su propio semental.";

            if (IsMaleSex(animal.Sexo))
                return "Cuando se asocia un semental (idSemental), el animal receptor debe ser hembra.";

            var semental = await db.Animales.AsNoTracking()
                .FirstOrDefaultAsync(a => a.IdAnimal == item.IdSemental.Value && a.EliminadoEn == null, ct);
            if (semental is null)
                return "El semental especificado no existe o está eliminado.";

            if (semental.IdRancho != animal.IdRancho)
                return "El semental debe pertenecer al mismo rancho del animal.";

            if (!IsUnknownSex(semental.Sexo) && !IsMaleSex(semental.Sexo))
                return "El semental especificado debe ser de sexo macho.";

            if (semental.FechaNacimiento.HasValue && fechaUtc.Date < semental.FechaNacimiento.Value.Date)
                return "La fecha del evento reproductivo no puede ser anterior a la fecha de nacimiento del semental.";
        }

        // Coherencia biológica entre partos de una misma hembra (gestación bovina ~283 días; mínimo fisiológico viable 240 días)
        if (IsCalvingEvent(normalizedTipo))
        {
            var previousCalvingDates = await db.EventosReproductivos.AsNoTracking()
                .Where(e => e.IdAnimal == item.IdAnimal
                            && e.EliminadoEn == null
                            && (!excludeEventId.HasValue || e.IdEventoReproductivo != excludeEventId.Value))
                .Select(e => new { e.Tipo, e.Fecha })
                .ToListAsync(ct);

            foreach (var prev in previousCalvingDates)
            {
                if (!IsCalvingEvent(prev.Tipo)) continue;
                var prevUtc = prev.Fecha.Kind == DateTimeKind.Utc ? prev.Fecha : prev.Fecha.ToUniversalTime();
                var daysDiff = Math.Abs((fechaUtc.Date - prevUtc.Date).TotalDays);
                if (daysDiff < 240)
                {
                    return "Incoherencia cronológica: ya existe otro parto registrado para esta hembra a menos de 240 días de diferencia.";
                }
            }
        }

        return null;
    }
}
