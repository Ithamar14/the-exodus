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
builder.Services.AddSingleton<GameWorld>(sp =>
    new GameWorld(sp.GetRequiredService<IGameRandom>(), savedRules));
builder.Services.AddHostedService<GameLoopService>();

var app = builder.Build();

app.UseDefaultFiles();
app.UseStaticFiles();

app.MapHub<GameHub>("/hubs/game");
app.MapGet("/health", () => Results.Ok(new { status = "ok" }));
app.MapFallbackToFile("index.html");

app.Run();
