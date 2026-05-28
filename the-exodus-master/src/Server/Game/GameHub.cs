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

    public async Task GetRules()
    {
        var schema = _world.GetRulesSchema();
        await Clients.Caller.SendAsync("RulesSchema", new RulesSchemaPayload(schema));
        var platforms = _world.GetPlatforms();
        await Clients.Caller.SendAsync("PlatformsUpdated", new PlatformsUpdatedPayload(platforms));
        var maps = _world.ListMaps();
        await Clients.Caller.SendAsync("MapList", new MapListPayload(maps));
    }

    public async Task UpdateRules(UpdateRulesRequest request)
    {
        var result = _world.TryUpdateRules(Context.ConnectionId, request.Updates);
        if (!result.Success)
        {
            await Clients.Caller.SendAsync("RulesUpdateRejected", new RulesUpdateRejected(result.Reason ?? "unknown"));
            return;
        }

        await Clients.All.SendAsync("RulesSchema", new RulesSchemaPayload(result.Schema!));
    }

    public async Task GetPlatforms()
    {
        var platforms = _world.GetPlatforms();
        await Clients.Caller.SendAsync("PlatformsUpdated", new PlatformsUpdatedPayload(platforms));
        var maps = _world.ListMaps();
        await Clients.Caller.SendAsync("MapList", new MapListPayload(maps));
    }

    public async Task ApplyPlatforms(ApplyPlatformsRequest request)
    {
        var result = _world.TryApplyPlatforms(Context.ConnectionId, request.Platforms);
        if (!result.Success) return;
        var platforms = _world.GetPlatforms();
        await Clients.All.SendAsync("PlatformsUpdated", new PlatformsUpdatedPayload(platforms));
    }

    public async Task SaveMap(SaveMapRequest request)
    {
        var result = _world.TrySaveMap(Context.ConnectionId, request.Name, request.Platforms);
        if (!result.Success)
        {
            await Clients.Caller.SendAsync("MapActionRejected", new MapActionRejected("save", result.Reason ?? "unknown"));
            return;
        }

        var platforms = _world.GetPlatforms();
        await Clients.All.SendAsync("PlatformsUpdated", new PlatformsUpdatedPayload(platforms));
        var maps = _world.ListMaps();
        await Clients.Caller.SendAsync("MapList", new MapListPayload(maps));
    }

    public async Task LoadMap(LoadMapRequest request)
    {
        var result = _world.TryLoadMap(Context.ConnectionId, request.Name);
        if (!result.Success)
        {
            await Clients.Caller.SendAsync("MapActionRejected", new MapActionRejected("load", result.Reason ?? "unknown"));
            return;
        }

        var platforms = _world.GetPlatforms();
        await Clients.All.SendAsync("PlatformsUpdated", new PlatformsUpdatedPayload(platforms));
    }

    public override Task OnDisconnectedAsync(Exception? exception)
    {
        _world.RemovePlayer(Context.ConnectionId);
        return base.OnDisconnectedAsync(exception);
    }
}
