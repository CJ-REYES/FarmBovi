using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace FarmBovi.Api.Models;

[Table("usuario")]
public sealed class Usuario
{
    [Key]
    [Column("Id")]
    [DatabaseGenerated(DatabaseGeneratedOption.Identity)]
    public int Id { get; set; }

    [Column("Nombre")]
    public string Nombre { get; set; } = string.Empty;

    [Column("Correo")]
    public string Correo { get; set; } = string.Empty;

    [Column("Contrasena")]
    public string Contrasena { get; set; } = string.Empty;

    [Column("Estado")]
    public string Estado { get; set; } = string.Empty;
}