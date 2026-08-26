using BudgetPlanner.Configuration;
using Google.Apis.Auth.OAuth2;
using Google.Apis.Auth.OAuth2.Flows;
using Google.Apis.Auth.OAuth2.Responses;
using Google.Apis.Gmail.v1;
using Google.Apis.Gmail.v1.Data;
using Google.Apis.Services;
using Microsoft.Extensions.Options;

namespace BudgetPlanner.Services;

public sealed class GmailApiClient : IGmailApiClient, IDisposable
{
    private readonly GoogleAuthorizationCodeFlow _flow;
    private readonly GmailService _gmailService;

    public GmailApiClient(IOptions<GoogleEmailOptions> googleEmailOptions)
    {
        var settings = googleEmailOptions.Value;
        _flow = new GoogleAuthorizationCodeFlow(new GoogleAuthorizationCodeFlow.Initializer
        {
            ClientSecrets = new ClientSecrets
            {
                ClientId = settings.ClientId,
                ClientSecret = settings.ClientSecret
            },
            Scopes = [GmailService.Scope.GmailSend]
        });
        var credential = new UserCredential(
            _flow,
            "me",
            new TokenResponse { RefreshToken = settings.RefreshToken });

        _gmailService = new GmailService(new BaseClientService.Initializer
        {
            HttpClientInitializer = credential,
            ApplicationName = "Ordo"
        });
    }

    public async Task SendRawMessageAsync(
        string userId,
        string rawMessage,
        CancellationToken cancellationToken = default)
    {
        var request = _gmailService.Users.Messages.Send(
            new Message { Raw = rawMessage },
            userId);
        await request.ExecuteAsync(cancellationToken);
    }

    public void Dispose()
    {
        _gmailService.Dispose();
        _flow.Dispose();
    }
}
