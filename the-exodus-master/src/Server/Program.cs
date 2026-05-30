using System.Text.Json;
using Server.Game;

var builder = WebApplication.CreateBuilder(args);

GameRules? savedRules = null;
const string RulesPath = "gamerules.json";
if (File.Exists(RulesPath))
{
    try
    {
        savedRules = JsonSerializer.Deserialize<GameRules>(File.ReadAllText(RulesPath));
    }
    catch { /* fall back to defaults */ }
}

builder.Services.AddSignalR();
builder.Services.AddSingleton<IGameRandom, SystemGameRandom>();
var mapsDirectory = Path.Combine(builder.Environment.ContentRootPath, "maps");

builder.Services.AddSingleton<GameWorld>(sp =>
    new GameWorld(sp.GetRequiredService<IGameRandom>(), savedRules, mapsDirectory));
builder.Services.AddHostedService<GameLoopService>();

var app = builder.Build();

app.UseDefaultFiles();
app.UseStaticFiles();

app.MapHub<GameHub>("/hubs/game");
app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

app.MapGet("/api/scenery/list", (IWebHostEnvironment env) =>
{
    var dir = Path.Combine(env.WebRootPath, "sprites", "objects");
    if (!Directory.Exists(dir)) return Results.Ok(Array.Empty<object>());
    var meta = LoadSceneryMeta(dir);
    var entries = Directory.GetFiles(dir, "*.png")
        .Select(Path.GetFileName)
        .Where(k => k is not null)
        .Select(k => new { key = k!, solid = meta.TryGetValue(k!, out var s) && s })
        .OrderBy(e => e.key)
        .ToArray();
    return Results.Ok(entries);
});

app.MapPost("/api/scenery/upload", async (HttpRequest request, IWebHostEnvironment env) =>
{
    var form = await request.ReadFormAsync();
    var file = form.Files.GetFile("file");
    if (file is null || file.Length == 0) return Results.BadRequest("No file.");
    var filename = Path.GetFileName(file.FileName);
    if (!filename.EndsWith(".png", StringComparison.OrdinalIgnoreCase) || filename.Length > 80)
        return Results.BadRequest("PNG files only, max 80 char name.");
    var solid = form["solid"].ToString() == "true";
    var dir = Path.Combine(env.WebRootPath, "sprites", "objects");
    Directory.CreateDirectory(dir);
    await using (var stream = File.Create(Path.Combine(dir, filename)))
        await file.CopyToAsync(stream);
    var meta = LoadSceneryMeta(dir);
    meta[filename] = solid;
    File.WriteAllText(Path.Combine(dir, "_meta.json"), JsonSerializer.Serialize(meta));
    return Results.Ok(new { key = filename, solid });
});

app.MapFallbackToFile("index.html");

app.Run();

static Dictionary<string, bool> LoadSceneryMeta(string dir)
{
    var path = Path.Combine(dir, "_meta.json");
    if (!File.Exists(path)) return new Dictionary<string, bool>();
    try { return JsonSerializer.Deserialize<Dictionary<string, bool>>(File.ReadAllText(path)) ?? new Dictionary<string, bool>(); }
    catch { return new Dictionary<string, bool>(); }
}
