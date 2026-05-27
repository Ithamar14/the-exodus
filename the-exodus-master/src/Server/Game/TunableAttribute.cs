namespace Server.Game;

[AttributeUsage(AttributeTargets.Property)]
public sealed class TunableAttribute(
    string label,
    string category,
    float min,
    float max,
    float step = 1f) : Attribute
{
    public string Label { get; } = label;
    public string Category { get; } = category;
    public float Min { get; } = min;
    public float Max { get; } = max;
    public float Step { get; } = step;
}
