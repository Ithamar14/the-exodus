using Microsoft.AspNetCore.SignalR;

namespace Server.Game;

public sealed class GameLoopService(GameWorld world, IHubContext<GameHub> hubContext) : BackgroundService
{
    private static readonly TimeSpan TickInterval = TimeSpan.FromMilliseconds(50);
    private readonly GameWorld _world = world;
    private readonly IHubContext<GameHub> _hubContext = hubContext;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TickInterval);

        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            var snapshot = _world.TickAndSnapshot((float)TickInterval.TotalSeconds);
            await _hubContext.Clients.All.SendAsync("WorldSnapshot", snapshot, stoppingToken);
        }
    }
}
