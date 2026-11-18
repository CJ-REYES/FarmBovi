using System.Security.Claims;
using System.Text;
using FarmBovi.Api.Data;
using FarmBovi.Api.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;
using Swashbuckle.AspNetCore.SwaggerGen;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(options =>
{
    options.SwaggerDoc("v1", new OpenApiInfo
    {
        Title = "FarmBovi API",
        Version = "v1",
        Description = "API para administrar FarmBovi y probar Login, Pull, Push y Auditoría."
    });

    options.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
    {
        Name = "Authorization",
        Description = "Pega solo el token JWT obtenido en POST /api/auth/login.",
        In = ParameterLocation.Header,
        Type = SecuritySchemeType.Http,
        Scheme = "bearer",
        BearerFormat = "JWT"
    });

    options.OperationFilter<SwaggerBearerOperationFilter>();
});
builder.Services.AddProblemDetails();
builder.Services.AddHttpContextAccessor();

var jwtKey = builder.Configuration["Jwt:SigningKey"] ?? builder.Configuration["Authentication:SigningKey"];
var jwtIssuer = builder.Configuration["Jwt:Issuer"] ?? "FarmBovi.Api";
var jwtAudience = builder.Configuration["Jwt:Audience"] ?? "FarmBovi.Clients";
if (string.IsNullOrWhiteSpace(jwtKey) || Encoding.UTF8.GetByteCount(jwtKey) < 32 ||
    string.IsNullOrWhiteSpace(jwtIssuer) || string.IsNullOrWhiteSpace(jwtAudience))
{
    throw new InvalidOperationException("Configura Jwt:SigningKey (mínimo 32 bytes), Jwt:Issuer y Jwt:Audience.");
}

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = jwtIssuer,
            ValidateAudience = true,
            ValidAudience = jwtAudience,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey)),
            ValidateLifetime = true,
            ClockSkew = TimeSpan.FromSeconds(30),
            NameClaimType = ClaimTypes.Name
        };
    });

// Política global: todo endpoint exige JWT salvo los marcados explícitamente con [AllowAnonymous].
builder.Services.AddAuthorization(options =>
{
    options.FallbackPolicy = new AuthorizationPolicyBuilder(JwtBearerDefaults.AuthenticationScheme)
        .RequireAuthenticatedUser()
        .Build();
});

builder.Services.AddScoped<FarmDomainValidationService>();
builder.Services.AddScoped<RanchAccessService>();

var connectionString = builder.Configuration.GetConnectionString("FarmBovi")
    ?? throw new InvalidOperationException("Configura ConnectionStrings:FarmBovi.");

builder.Services.AddDbContext<FarmDbContext>(options => options
    .UseMySQL(connectionString)
    .ReplaceService<IHistoryRepository, MariaDbCompatibleHistoryRepository>());
builder.Services.AddHealthChecks().AddCheck<DatabaseHealthCheck>("database");

var allowedOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? [];
builder.Services.AddCors(options => options.AddPolicy("Frontend", policy =>
{
    if (allowedOrigins.Length > 0)
    {
        policy.WithOrigins(allowedOrigins).AllowAnyHeader().AllowAnyMethod();
    }
}));

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseDeveloperExceptionPage();

    await using var scope = app.Services.CreateAsyncScope();
    var dbContext = scope.ServiceProvider.GetRequiredService<FarmDbContext>();
    
    // 1. Aplica migraciones automáticamente al iniciar
    await dbContext.Database.MigrateAsync();

    // 2. Genera un hash criptográfico válido con PasswordHasher y lo actualiza directamente en la BD
    var hasher = new Microsoft.AspNetCore.Identity.PasswordHasher<object>();
    var hashedPassword = hasher.HashPassword(new object(), "miPassword123");

    await dbContext.Database.ExecuteSqlRawAsync(
        "UPDATE usuario SET Contrasena = {0} WHERE Correo = 'prueba@farmbovi.com';", 
        hashedPassword
    );

    app.UseSwagger();
    app.UseSwaggerUI();
}
else
{
    app.UseExceptionHandler();
    app.UseHsts();
    app.UseHttpsRedirection();
}

app.UseStatusCodePages();

if (Directory.Exists(Path.Combine(app.Environment.ContentRootPath, "wwwroot")))
{
    app.UseDefaultFiles();
    app.UseStaticFiles(new StaticFileOptions
    {
        OnPrepareResponse = context =>
        {
            if (context.File.Name is "sw.js" or "index.html" or "manifest.webmanifest")
            {
                context.Context.Response.Headers.CacheControl = "no-cache";
            }
        }
    });
}

app.UseCors("Frontend");
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers().RequireAuthorization();

// Excepción pública: sonda de salud para despliegue/monitoreo (no expone datos de negocio).
app.MapHealthChecks("/health").AllowAnonymous();

app.Run();

/// <summary>Expuesto para pruebas de integración con WebApplicationFactory.</summary>
public partial class Program;

public sealed class SwaggerBearerOperationFilter : IOperationFilter
{
    public void Apply(OpenApiOperation operation, OperationFilterContext context)
    {
        var allowsAnonymous = context.ApiDescription.ActionDescriptor.EndpointMetadata?
            .OfType<IAllowAnonymous>().Any() == true;
        if (allowsAnonymous) return;

        operation.Security.Add(new OpenApiSecurityRequirement
        {
            [new OpenApiSecurityScheme
            {
                Reference = new OpenApiReference
                {
                    Type = ReferenceType.SecurityScheme,
                    Id = "Bearer"
                }
            }] = Array.Empty<string>()
        });
    }
}