import { afterEach, describe, expect, it, vi } from "vitest";
import { sendWhatsAppText } from "@/lib/whatsapp.server";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env["LOVABLE_API_KEY"];
  delete process.env["WHATSAPP_API_KEY"];
});

describe("sendWhatsAppText", () => {
  it("aborts the gateway request if it hangs", async () => {
    process.env["LOVABLE_API_KEY"] = "lovable";
    process.env["WHATSAPP_API_KEY"] = "whatsapp";
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(init?.signal?.aborted).toBe(false);
      return new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendWhatsAppText("+353861234567", "held")).resolves.toBe("wamid.1");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
