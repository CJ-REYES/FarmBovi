using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using FarmBovi.Api.Data;
using FarmBovi.Api.DTOs;
using FarmBovi.Api.Models;

namespace FarmBovi.Api.Controllers
{
    [Route("api/movimientos-animales")]
    [ApiController]
    public class MovimientoAnimalController : ControllerBase
    {
        private readonly FarmDbContext _context;

        public MovimientoAnimalController(FarmDbContext context)
        {
            _context = context;
        }

        [HttpGet]
        public async Task<ActionResult<IEnumerable<MovimientoAnimal>>> GetMovimientos()
        {
            return await _context.MovimientosAnimales
                .Where(m => m.EliminadoEn == null)
                .ToListAsync();
        }

        [HttpPost]
        public async Task<ActionResult<MovimientoAnimal>> PostMovimiento(MovimientoAnimalCreateDto dto)
        {
            var movimiento = new MovimientoAnimal
            {
                IdAnimal = dto.IdAnimal,
                IdLoteOrigen = dto.IdLoteOrigen,
                IdLoteDestino = dto.IdLoteDestino,
                Tipo = dto.Tipo,
                Fecha = dto.Fecha,
                OrigenExterno = dto.OrigenExterno,
                DestinoExterno = dto.DestinoExterno,
                Motivo = dto.Motivo,
                IdAutor = dto.IdAutor
            };

            _context.MovimientosAnimales.Add(movimiento);
            await _context.SaveChangesAsync();

            return CreatedAtAction(nameof(GetMovimientos), new { id = movimiento.IdMovimiento }, movimiento);
        }
    }
}