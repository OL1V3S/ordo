using System.Security.Claims;
using BudgetPlanner.Contracts.ImportPreviews;
using BudgetPlanner.Import;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BudgetPlanner.Controllers;

[ApiController]
[Authorize]
[Route("api/import-previews")]
public sealed class ImportPreviewsController(
    IImportPreviewService previews) : ControllerBase
{
    private const long MultipartRequestLimit = ImportPreviewService.MaximumUploadBytes + (64 * 1024);

    [HttpPost]
    [RequestSizeLimit(MultipartRequestLimit)]
    [RequestFormLimits(
        MultipartBodyLengthLimit = MultipartRequestLimit,
        MemoryBufferThreshold = (int)MultipartRequestLimit)]
    [ServiceFilter(typeof(ImportPreviewAdmissionFilter))]
    public async Task<IActionResult> Create(
        [FromForm] string? sourceType,
        [FromForm] IFormFile? file,
        CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId is null) return Unauthorized();
        if (string.IsNullOrWhiteSpace(sourceType))
            return BadRequest(new ImportPreviewError("source_required", "Choose a supported bank before uploading."));
        if (!ImportStatementSources.IsSupported(sourceType))
            return BadRequest(new ImportPreviewError("unsupported_statement_source", "The selected statement source is not supported."));
        if (file is null) return BadRequest(new ImportPreviewError("file_required", "Choose a PDF to upload."));
        if (file.Length > ImportPreviewService.MaximumUploadBytes)
            return StatusCode(StatusCodes.Status413PayloadTooLarge,
                new ImportPreviewError("upload_too_large", "The PDF exceeds the 10 MiB limit."));

        await using var stream = file.OpenReadStream();
        var result = await previews.CreateAsync(userId, sourceType, stream, file.Length, cancellationToken);
        if (!result.IsSuccess) return ErrorResult(result.Error!);
        return result.Reused
            ? Ok(result.Preview)
            : CreatedAtAction(nameof(Get), new { batchId = result.Preview!.BatchId }, result.Preview);
    }

    [HttpGet("open")]
    public async Task<IActionResult> GetOpen([FromQuery] string? sourceType, CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId is null) return Unauthorized();
        if (string.IsNullOrWhiteSpace(sourceType))
            return BadRequest(new ImportPreviewError("source_required", "Choose a supported bank."));
        if (!ImportStatementSources.IsSupported(sourceType))
            return BadRequest(new ImportPreviewError("unsupported_statement_source", "The selected statement source is not supported."));
        var preview = await previews.GetOpenAsync(userId, sourceType!, cancellationToken);
        return preview is null ? NoContent() : Ok(preview);
    }

    [HttpGet("{batchId:guid}")]
    public async Task<IActionResult> Get(Guid batchId, CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId is null) return Unauthorized();
        var preview = await previews.GetAsync(userId, batchId, cancellationToken);
        return preview is null ? NotFound() : Ok(preview);
    }

    [HttpPatch("{batchId:guid}/rows/{rowId:guid}")]
    public async Task<IActionResult> UpdateRow(Guid batchId, Guid rowId, UpdateImportPreviewRowRequest request, CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId is null) return Unauthorized();
        var result = await previews.UpdateRowAsync(userId, batchId, rowId, request, cancellationToken);
        if (!result.IsSuccess) return ErrorResult(result.Error!);
        var row = result.Preview!.Rows.Single(value => value.RowId == rowId);
        return Ok(row);
    }

    private IActionResult ErrorResult(ImportPreviewError error) => error.Code switch
    {
        "upload_too_large" => StatusCode(StatusCodes.Status413PayloadTooLarge, error),
        "preview_not_found" => NotFound(),
        "processing_cancelled" => StatusCode(499, error),
        "processing_timed_out" => StatusCode(StatusCodes.Status408RequestTimeout, error),
        "import_in_progress" => Conflict(error),
        "row_not_selectable" or "row_validation_failed" or "file_required"
            or "source_required" or "unsupported_statement_source" => BadRequest(error),
        _ => UnprocessableEntity(error)
    };

}
