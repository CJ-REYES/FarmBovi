using System.Linq.Expressions;
using FarmBovi.Api.Models;

namespace FarmBovi.Api.DTOs;

public sealed record CattleResponse(
    int Id,
    string EarTag,
    string Name,
    string Breed,
    string Sex,
    DateOnly? BirthDate,
    DateTime CreatedAt)
{
    public static readonly Expression<Func<Cattle, CattleResponse>> Projection = animal => new(
        animal.Id, animal.EarTag, animal.Name, animal.Breed,
        animal.Sex, animal.BirthDate, animal.CreatedAt);

    public static CattleResponse From(Cattle animal) => new(
        animal.Id, animal.EarTag, animal.Name, animal.Breed,
        animal.Sex, animal.BirthDate, animal.CreatedAt);
}
