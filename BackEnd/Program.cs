using FarmBovi.Api.Data;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.AddProblemDetails();

var connectionString = builder.Configuration.GetConnectionString("FarmBovi")
    ?? throw new InvalidOperationException("Configura ConnectionStrings:FarmBovi.");

builder.Services.AddDbContext<FarmDbContext>(options => options.UseMySQL(connectionString));
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

app.UseExceptionHandler();
app.UseStatusCodePages();

if (app.Environment.IsDevelopment())
{
    // A committed migration creates the local database on the first run.
    // Production migrations must be applied explicitly before deployment.
    await using var scope = app.Services.CreateAsyncScope();
    await scope.ServiceProvider.GetRequiredService<FarmDbContext>().Database.MigrateAsync();
    app.UseSwagger();
    app.UseSwaggerUI();
}
else
{
    app.UseHsts();
    app.UseHttpsRedirection();
}

// Publishing can place FrontEnd/dist in wwwroot to serve the app on one origin.
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
app.MapControllers();
app.MapHealthChecks("/health");

app.Run();
