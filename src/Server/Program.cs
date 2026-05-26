using Server.Game;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSignalR();
builder.Services.AddSingleton<IGameRandom, SystemGameRandom>();
builder.Services.AddSingleton<GameWorld>();
builder.Services.AddHostedService<GameLoopService>();

var app = builder.Build();

app.UseDefaultFiles();
app.UseStaticFiles();

app.MapHub<GameHub>("/hubs/game");
app.MapGet("/health", () => Results.Ok(new { status = "ok" }));
app.MapFallbackToFile("index.html");

app.Run();
