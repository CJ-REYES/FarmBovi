using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using FarmBovi.Api.Data;
using FarmBovi.Api.DTOs;
using FarmBovi.Api.Models;

namespace FarmBovi.Api.Controllers
{
    [Route("api/alimentacion")]
    [ApiController]
    public class AlimentacionController : ControllerBase
    {
        private readonly FarmDbContext _context;

        public AlimentacionController(FarmDbContext context)
        {
            _context = context;
        }

        [HttpGet]
        public async Task<ActionResult<IEnumerable<Alimentacion>>> GetAlimentaciones()
        {
            return await _context.Alimentaciones
                .Where(a => a.EliminadoEn == null)
                .ToListAsync();
        }

        [HttpPost]
        public async Task<ActionResult<Alimentacion>> PostAlimentacion(AlimentacionCreateDto dto)
        {
            var alimentacion = new Alimentacion
            {
                IdAnimal = dto.IdAnimal,
                IdLote = dto.IdLote,
                Alimento = dto.Alimento,
                Racion = dto.Racion,
                Cantidad = dto.Cantidad,
                Unidad = dto.Unidad,
                Frecuencia = dto.Frecuencia,
                Inicio = dto.Inicio,
                Fin = dto.Fin,
                CambioDieta = dto.CambioDieta,
                IdAutor = dto.IdAutor
            };

            _context.Alimentaciones.Add(alimentacion);
            await _context.SaveChangesAsync();

            return CreatedAtAction(nameof(GetAlimentaciones), new { id = alimentacion.IdAlimentacion }, alimentacion);
        }
    }
}