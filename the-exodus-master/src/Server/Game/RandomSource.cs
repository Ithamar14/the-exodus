namespace Server.Game;

public interface IGameRandom
{
    float NextSingle();
    int NextInt(int maxExclusive);
}

public sealed class SystemGameRandom : IGameRandom
{
    private readonly Random _random = Random.Shared;

    public float NextSingle() => _random.NextSingle();

    public int NextInt(int maxExclusive) => _random.Next(maxExclusive);
}

public sealed class ScriptedGameRandom : IGameRandom
{
    private readonly Queue<float> _singles;
    private readonly Queue<int> _ints;

    public ScriptedGameRandom(IEnumerable<float>? singles = null, IEnumerable<int>? ints = null)
    {
        _singles = new Queue<float>(singles ?? Array.Empty<float>());
        _ints = new Queue<int>(ints ?? Array.Empty<int>());
    }

    public float NextSingle()
    {
        if (_singles.Count == 0)
        {
            return 0.5f;
        }

        return _singles.Dequeue();
    }

    public int NextInt(int maxExclusive)
    {
        if (_ints.Count > 0)
        {
            return Math.Clamp(_ints.Dequeue(), 0, maxExclusive - 1);
        }

        return Math.Clamp((int)(NextSingle() * maxExclusive), 0, maxExclusive - 1);
    }
}
