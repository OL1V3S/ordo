using System.Threading.Channels;

namespace BudgetPlanner.Services;

public enum BackgroundEmailKind
{
    ConfirmationResend,
    PasswordReset
}

/// <summary>
/// One deferred account email. Carries only the user ID and language; the worker
/// reloads the user and builds the token, link and message itself (#319).
/// </summary>
public readonly record struct BackgroundEmailJob(
    string UserId,
    EmailLanguage Language,
    BackgroundEmailKind Kind);

/// <summary>
/// In-process queue for resend-confirmation and forgot-password emails, so the
/// request time does not depend on whether an account exists (#319). Queued items
/// are lost if the process restarts; the user can request again.
/// </summary>
public interface IBackgroundEmailQueue
{
    /// <summary>Never waits. Returns false when the queue is full.</summary>
    bool TryEnqueue(BackgroundEmailJob job);

    ChannelReader<BackgroundEmailJob> Reader { get; }
}

public sealed class BackgroundEmailQueue : IBackgroundEmailQueue
{
    public const int DefaultCapacity = 256;

    private readonly Channel<BackgroundEmailJob> _channel;

    public BackgroundEmailQueue() : this(DefaultCapacity)
    {
    }

    public BackgroundEmailQueue(int capacity)
    {
        _channel = Channel.CreateBounded<BackgroundEmailJob>(new BoundedChannelOptions(capacity)
        {
            SingleReader = true,
            SingleWriter = false,
            FullMode = BoundedChannelFullMode.Wait
        });
    }

    public bool TryEnqueue(BackgroundEmailJob job) => _channel.Writer.TryWrite(job);

    public ChannelReader<BackgroundEmailJob> Reader => _channel.Reader;
}
