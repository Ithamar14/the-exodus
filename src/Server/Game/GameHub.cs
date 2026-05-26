using Microsoft.AspNetCore.SignalR;

namespace Server.Game;

public sealed class GameHub(GameWorld world) : Hub
{
    private readonly GameWorld _world = world;

    public async Task Join(JoinRequest request)
    {
        var result = _world.TryAddPlayer(Context.ConnectionId, request.Name);
        if (!result.Success)
        {
            await Clients.Caller.SendAsync("JoinRejected", new JoinRejected(result.Reason ?? "unknown"));
            return;
        }

        await Clients.Caller.SendAsync("Joined", new Joined(result.PlayerId!));
    }

    public Task SetTarget(MoveTargetRequest request)
    {
        _world.TrySetTarget(Context.ConnectionId, request.X, request.Y);
        return Task.CompletedTask;
    }

    public Task SetInput(MoveInputRequest request)
    {
        _world.TrySetInput(Context.ConnectionId, request.DirX, request.Jump);
        return Task.CompletedTask;
    }

    public Task ShootFireball()
    {
        _world.TryShootFireball(Context.ConnectionId);
        return Task.CompletedTask;
    }

    public async Task StartRound(StartRoundRequest request)
    {
        var result = _world.TryStartRound(Context.ConnectionId);
        if (!result.Success)
        {
            await Clients.Caller.SendAsync("RoundActionRejected", new RoundActionRejected("start", result.Reason ?? "unknown"));
            return;
        }

        await Clients.All.SendAsync("RoundStarted", new RoundStarted(result.StarterId!));
    }

    public async Task RestartRound(RestartRoundRequest request)
    {
        var result = _world.TryRestartRound(Context.ConnectionId);
        if (!result.Success)
        {
            await Clients.Caller.SendAsync("RoundActionRejected", new RoundActionRejected("restart", result.Reason ?? "unknown"));
            return;
        }

        await Clients.All.SendAsync("RoundRestarted", new RoundRestarted(result.StarterId!));
    }

    public async Task Emote(EmoteRequest request)
    {
        var result = _world.TryEmote(Context.ConnectionId, request.Code);
        if (!result.Success)
        {
            return;
        }

        await Clients.All.SendAsync("PlayerEmoted", new PlayerEmoted(result.PlayerId!, result.Code!));
    }

    public override Task OnDisconnectedAsync(Exception? exception)
    {
        _world.RemovePlayer(Context.ConnectionId);
        return base.OnDisconnectedAsync(exception);
    }
}
