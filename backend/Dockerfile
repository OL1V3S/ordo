FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src

COPY backend/backend.csproj backend/
COPY backend.PdfWorker/backend.PdfWorker.csproj backend.PdfWorker/
RUN dotnet restore backend/backend.csproj

COPY backend/ backend/
COPY backend.PdfWorker/ backend.PdfWorker/
RUN dotnet publish backend/backend.csproj --configuration Release --no-restore --output /app/publish

FROM mcr.microsoft.com/dotnet/aspnet:9.0
WORKDIR /app

COPY --from=build /app/publish .

USER $APP_UID

ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080

ENTRYPOINT ["dotnet", "backend.dll"]
