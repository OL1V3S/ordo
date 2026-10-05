import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../../shared/localization/i18n";
import { clearSession, establishSession } from "../../../shared/auth/session";
import { cashFlowApi } from "../api/cashFlowApi";
import { useCashFlow } from "./useCashFlow";

vi.mock("../api/cashFlowApi", () => ({ cashFlowApi: { get: vi.fn() } }));

describe("cash-flow hook messages in Spanish", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 7, 14, 12));
    cashFlowApi.get.mockReset();
    await i18n.changeLanguage("es");
  });
  afterEach(async () => {
    clearSession();
    vi.useRealTimers();
    await act(async () => { await i18n.changeLanguage("en"); });
  });

  it("returns the localized sign-in message and follows a language change without refetching", async () => {
    const { result } = renderHook(() => useCashFlow("2026-08"));
    await waitFor(() => expect(result.current.error).toBe("Inicia sesión para ver el flujo de efectivo registrado."));
    expect(result.current.data).toBeNull();
    await act(async () => { await i18n.changeLanguage("en"); });
    expect(result.current.error).toBe("Sign in to view recorded cash flow.");
    expect(cashFlowApi.get).not.toHaveBeenCalled();
  });

  it("returns the localized load failure message and keeps the retry path", async () => {
    establishSession("owner-a", "a@example.test");
    cashFlowApi.get.mockRejectedValue(new Error("failed"));
    const { result } = renderHook(() => useCashFlow("2026-08"));
    await waitFor(() => expect(result.current.error).toBe("No pudimos cargar el flujo de efectivo registrado. Inténtalo de nuevo."));
    expect(result.current.data).toBeNull();
    await act(async () => { await i18n.changeLanguage("en"); });
    expect(result.current.error).toBe("We couldn’t load recorded cash flow. Try again.");
    act(() => result.current.refresh());
    await waitFor(() => expect(cashFlowApi.get).toHaveBeenCalledTimes(2));
  });
});
