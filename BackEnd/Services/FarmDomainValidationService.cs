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
            var origenExists = await db.Lotes.AsNoTracking()
                .AnyAsync(l => l.IdLote == movimiento.IdLoteOrigen.Value && l.EliminadoEn == null, ct);
            if (!origenExists)
                return (null, "El lote de origen especificado no existe o está eliminado.");
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

        if (string.IsNullOrWhiteSpace(item.Tipo) ||
            string.IsNullOrWhiteSpace(item.Medicamento))
        {
            return "El tipo y el medicamento del tratamiento son obligatorios.";
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
            var respExists = await db.Usuarios.AsNoTracking()
                .AnyAsync(u => u.IdUsuario == item.IdResponsable.Value, ct);
            if (!respExists)
                return "El usuario responsable especificado no existe.";
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
            if (animalEvento is not null && animalEvento.IdRancho != item.IdRancho)
                return "El tratamiento vinculado pertenece a un animal de otro rancho.";
        }

        return null;
    }

    // Regla 14: Pesaje.pesoRealKg > 0 proviene de báscula y nunca se sustituye con EstimacionPeso.
    public static string? ValidatePesaje(decimal pesoRealKg) =>
        pesoRealKg <= 0
            ? "El peso real de báscula (pesoRealKg) debe ser mayor que cero."
            : null;
}