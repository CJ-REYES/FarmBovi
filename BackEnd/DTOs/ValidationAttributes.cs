using System.ComponentModel.DataAnnotations;

namespace FarmBovi.Api.DTOs;

/// <summary>
/// Valida que un Guid (o Guid? cuando tiene valor) no sea Guid.Empty.
/// </summary>
[AttributeUsage(AttributeTargets.Property | AttributeTargets.Field | AttributeTargets.Parameter)]
public sealed class NotEmptyGuidAttribute : ValidationAttribute
{
    public bool AllowNull { get; set; }

    public NotEmptyGuidAttribute() : base("El campo {0} debe ser un identificador GUID válido y no vacío.")
    {
    }

    public override bool IsValid(object? value)
    {
        if (value is null)
            return AllowNull;

        return value is Guid guid && guid != Guid.Empty;
    }
}

/// <summary>
/// Valida que una cadena no sea nula, vacía ni compuesta únicamente por espacios en blanco.
/// </summary>
[AttributeUsage(AttributeTargets.Property | AttributeTargets.Field | AttributeTargets.Parameter)]
public sealed class NotWhiteSpaceAttribute : ValidationAttribute
{
    public NotWhiteSpaceAttribute() : base("El campo {0} es obligatorio y no puede estar vacío ni contener solo espacios.")
    {
    }

    public override bool IsValid(object? value) =>
        value is string text && !string.IsNullOrWhiteSpace(text);
}

/// <summary>
/// Valida que una fecha no sea default (0001-01-01) y se encuentre dentro de un rango operativo válido (1900-2100 UTC).
/// </summary>
[AttributeUsage(AttributeTargets.Property | AttributeTargets.Field | AttributeTargets.Parameter)]
public sealed class ValidDateRangeAttribute : ValidationAttribute
{
    private static readonly DateTime MinAllowed = new(1900, 1, 1, 0, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime MaxAllowed = new(2100, 12, 31, 23, 59, 59, DateTimeKind.Utc);

    public bool AllowNull { get; set; }

    public ValidDateRangeAttribute() : base("El campo {0} debe contener una fecha válida entre 1900-01-01 y 2100-12-31.")
    {
    }

    public override bool IsValid(object? value)
    {
        if (value is null)
            return AllowNull;

        if (value is not DateTime dt || dt == default)
            return false;

        var utc = dt.Kind == DateTimeKind.Local ? dt.ToUniversalTime() : DateTime.SpecifyKind(dt, DateTimeKind.Utc);
        return utc >= MinAllowed && utc <= MaxAllowed;
    }
}

/// <summary>
/// Valida que una cantidad decimal sea estrictamente mayor que cero.
/// </summary>
[AttributeUsage(AttributeTargets.Property | AttributeTargets.Field | AttributeTargets.Parameter)]
public sealed class PositiveDecimalAttribute : ValidationAttribute
{
    public PositiveDecimalAttribute() : base("El campo {0} debe ser mayor que cero.")
    {
    }

    public override bool IsValid(object? value) =>
        value is decimal dec && dec > 0m;
}
