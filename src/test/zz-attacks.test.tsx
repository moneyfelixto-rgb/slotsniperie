// Adapted from the PR #1 attack suite. Assertions follow the fixed contract.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hmacHex } from "@/lib/hmac";
import { createFakeSupabase, type FakeSupabase } from "./fake-supabase";
import {
  freshTimestamp,
  lockedEvent,
  signedBotEventRequest,
  TEST_WEBHOOK_SECRET,
} from "./sign-bot-event";

const state = vi.hoisted(() => ({ fake: null as FakeSupabase | null }));
const sendWhatsAppText = vi.hoisted(() => vi.fn(async (_t: string, _b: string) => "wamid.test"));
vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return state.fake!.admin;
  },
}));
vi.mock("@/lib/whatsapp.server", () => ({ sendWhatsAppText }));
import { CLAIM_STALE_MS, handleBotEvent } from "@/lib/bot-event.server";

state.fake = createFakeSupabase();
beforeEach(() => {
  state.fake!.reset();
  sendWhatsAppText.mockReset();
  sendWhatsAppText.mockResolvedValue("wamid.test");
  process.env["BOT_WEBHOOK_SECRET"] = TEST_WEBHOOK_SECRET;
  process.env["PUBLIC_SITE_URL"] = "https://slotsniper.test";
});

async function rawReq(raw: string | Uint8Array, sig?: string) {
  const s =
    sig ??
    (await hmacHex(
      TEST_WEBHOOK_SECRET,
      typeof raw === "string" ? raw : new TextDecoder().decode(raw),
    ));
  return new Request("https://slotsniper.test/api/public/bot-event", {
    method: "POST",
    headers: { "content-type": "application/json", "x-bot-signature": s },
    body: typeof raw === "string" ? raw : new Blob([Uint8Array.from(raw)]),
  });
}

describe("forged signatures", () => {
  it("rejects signature of a different body, wrong secret, sha256= prefix, truncated, empty", async () => {
    const ev = lockedEvent({ event_id: "f1" });
    const other = await hmacHex(TEST_WEBHOOK_SECRET, JSON.stringify({ ...ev, centre: "Finglas" }));
    const wrong = await hmacHex("nope", JSON.stringify(ev));
    const good = await hmacHex(TEST_WEBHOOK_SECRET, JSON.stringify(ev));
    for (const sig of [
      other,
      wrong,
      "sha256=" + good,
      good.slice(0, 63),
      good + "00",
      "x".repeat(64),
    ]) {
      const r = await handleBotEvent(await signedBotEventRequest(ev, { signature: sig }));
      expect(r.status, sig.slice(0, 10)).toBe(401);
    }
    expect(state.fake!.bookings()).toHaveLength(0);
    expect(state.fake!.events()).toHaveLength(0);
  });

  it("accepts uppercase hex", async () => {
    const ev = lockedEvent({ event_id: "f2" });
    const good = await hmacHex(TEST_WEBHOOK_SECRET, JSON.stringify(ev));
    const r = await handleBotEvent(
      await signedBotEventRequest(ev, { signature: good.toUpperCase() }),
    );
    expect(r.status).toBe(200);
  });

  it("verifies the raw body: non-canonical whitespace and key order signed as sent is accepted", async () => {
    const ev = lockedEvent({ event_id: "f3" });
    const raw =
      '{ "time":"10:30" ,\n "event_id":"f3","timestamp":"' +
      ev.timestamp +
      '","status":"SLOT_LOCKED","phone":"+353861234567","centre":"Baile Átha Cliath","date":"2026-11-10"}';
    expect((await handleBotEvent(await rawReq(raw))).status).toBe(200);
    const sig = await hmacHex(TEST_WEBHOOK_SECRET, raw);
    const tampered = await handleBotEvent(
      await rawReq(JSON.stringify(JSON.parse(raw)).replace("f3", "f3b"), sig),
    );
    expect(tampered.status).toBe(401);
  });

  it("a UTF-8 BOM signed over the raw bytes does not match the decoded body", async () => {
    const body = JSON.stringify(lockedEvent({ event_id: "bom" }));
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(body)]);
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(TEST_WEBHOOK_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sigOverBytes = Buffer.from(await crypto.subtle.sign("HMAC", key, bytes)).toString("hex");
    const r = await handleBotEvent(await rawReq(bytes, sigOverBytes));
    expect(r.status).toBe(401);
  });
});

describe("timestamp skew", () => {
  const cases: [string, number][] = [
    ["stale 5m+1s", -301_000],
    ["future 5m+1s", 301_000],
    ["stale 1h", -3_600_000],
  ];
  for (const [name, off] of cases) {
    it(`rejects ${name}`, async () => {
      const r = await handleBotEvent(
        await signedBotEventRequest(
          lockedEvent({ event_id: name, timestamp: freshTimestamp(off) }),
        ),
      );
      expect(r.status).toBe(401);
      expect(state.fake!.events()).toHaveLength(0);
    });
  }

  it("accepts a zoned timestamp inside the window and rejects a zone-less timestamp", async () => {
    const d = new Date(Date.now() + 3_600_000);
    const withOffset =
      d
        .toISOString()
        .replace("Z", "")
        .replace(/\.\d+$/, "") + "+01:00";
    const local = new Date(Date.now()).toISOString().slice(0, 19);
    expect(
      (
        await handleBotEvent(
          await signedBotEventRequest(lockedEvent({ event_id: "o1", timestamp: withOffset })),
        )
      ).status,
    ).not.toBe(500);
    expect(
      (
        await handleBotEvent(
          await signedBotEventRequest(lockedEvent({ event_id: "o2", timestamp: local })),
        )
      ).status,
    ).toBe(400);
  });
});

describe("replay", () => {
  it("exact replay of the same bytes returns the stored booking_id and pay_url", async () => {
    const raw = JSON.stringify(lockedEvent({ event_id: "r1" }));
    const a = await (await handleBotEvent(await rawReq(raw))).json();
    const b = await (await handleBotEvent(await rawReq(raw))).json();
    expect(b.duplicate).toBe(true);
    expect(b.booking_id).toBe(a.booking_id);
    expect(b.pay_url).toBe(a.pay_url);
    expect(state.fake!.bookings()).toHaveLength(1);
    expect(sendWhatsAppText).toHaveBeenCalledTimes(1);
  });

  it("same event_id with a different slot body stays the first booking", async () => {
    await handleBotEvent(await signedBotEventRequest(lockedEvent({ event_id: "r2" })));
    const b = await (
      await handleBotEvent(
        await signedBotEventRequest(lockedEvent({ event_id: "r2", centre: "Finglas" })),
      )
    ).json();
    expect(b.duplicate).toBe(true);
    expect(b.booking_id).toBeTruthy();
    expect(state.fake!.bookings()).toHaveLength(1);
    expect(state.fake!.bookings()[0]?.test_centre).toBe("tallaght");
  });
});

describe("concurrent duplicates", () => {
  it("5 parallel deliveries of one event: one booking, one WhatsApp, losers are in progress", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    sendWhatsAppText.mockImplementation(async () => {
      await gate;
      return "wamid";
    });
    const raw = JSON.stringify(lockedEvent({ event_id: "c1" }));
    let finished = 0;
    const pending = Array.from({ length: 5 }, async () => {
      const response = await handleBotEvent(await rawReq(raw));
      finished += 1;
      return response;
    });
    await vi.waitFor(() => {
      expect(sendWhatsAppText).toHaveBeenCalledTimes(1);
      expect(finished).toBe(4);
    });
    release();
    const responses = await Promise.all(pending);
    const early = await Promise.all(
      responses.map(async (response) => ({ status: response.status, body: await response.json() })),
    );
    expect(state.fake!.bookings()).toHaveLength(1);
    expect(sendWhatsAppText).toHaveBeenCalledTimes(1);
    const winner = early.find((item) => item.body.booking_id);
    const waiting = early.filter((item) => item.status === 425);
    expect(winner?.status).toBe(200);
    expect(waiting.length).toBeGreaterThan(0);
    expect(
      waiting.every((item) => item.body.reason === "in_progress" && item.body.ok === false),
    ).toBe(true);

    const replay = await handleBotEvent(await rawReq(raw));
    const replayBody = await replay.json();
    expect(replay.status).toBe(200);
    expect(replayBody.duplicate).toBe(true);
    expect(replayBody.booking_id).toBe(winner?.body.booking_id);
    expect(replayBody.pay_url).toBe(`https://slotsniper.test/pay/${winner?.body.booking_id}`);
  });

  it("a fresh claim with no stored result is in progress, not a successful duplicate", async () => {
    await state.fake!.admin.from("bot_events").insert({
      source: "worker",
      event: "SLOT_LOCKED",
      delivery_id: "crash1",
      payload: { event: {} },
    });
    const response = await handleBotEvent(
      await signedBotEventRequest(lockedEvent({ event_id: "crash1" })),
    );
    const body = await response.json();
    expect(response.status).toBe(425);
    expect(body).toEqual({ ok: false, reason: "in_progress" });
    expect(state.fake!.bookings()).toHaveLength(0);
  });

  it("reclaims a claim older than 60s and returns the new booking", async () => {
    await state.fake!.admin.from("bot_events").insert({
      source: "worker",
      event: "SLOT_LOCKED",
      delivery_id: "stale-claim",
      received_at: new Date(Date.now() - CLAIM_STALE_MS - 1_000).toISOString(),
      payload: { event: {} },
    });
    const response = await handleBotEvent(
      await signedBotEventRequest(lockedEvent({ event_id: "stale-claim" })),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.booking_id).toBeTruthy();
    expect(body.pay_url).toBe(`https://slotsniper.test/pay/${body.booking_id}`);
    expect(state.fake!.bookings()).toHaveLength(1);
    expect(sendWhatsAppText).toHaveBeenCalledTimes(1);
  });
});

describe("two holds on the same slot", () => {
  it("different event ids for one slot return 409 and send one WhatsApp", async () => {
    const a = await handleBotEvent(await signedBotEventRequest(lockedEvent({ event_id: "h1" })));
    const b = await handleBotEvent(
      await signedBotEventRequest(
        lockedEvent({ event_id: "h2", phone: "+353800000001", time: "10:30" }),
      ),
    );
    expect(a.status).toBe(200);
    expect(b.status).toBe(409);
    expect(sendWhatsAppText).toHaveBeenCalledTimes(1);
  });

  it("parallel holds on one slot let exactly one win", async () => {
    const responses = await Promise.all(
      ["p1", "p2", "p3"].map(async (id) =>
        handleBotEvent(await signedBotEventRequest(lockedEvent({ event_id: id }))),
      ),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409, 409]);
  });

  it("treats centre case and surrounding space as the same slot", async () => {
    const first = await handleBotEvent(
      await signedBotEventRequest(lockedEvent({ event_id: "k1", centre: "Tallaght" })),
    );
    const second = await handleBotEvent(
      await signedBotEventRequest(lockedEvent({ event_id: "k2", centre: " tallaght " })),
    );
    const third = await handleBotEvent(
      await signedBotEventRequest(lockedEvent({ event_id: "k3", centre: "Tallaght  Test Centre" })),
    );
    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(third.status).toBe(200);
    expect(
      state
        .fake!.bookings()
        .map((row) => row.test_centre)
        .sort(),
    ).toEqual(["tallaght", "tallaght test centre"]);
  });

  it("does not let an unswept expired pending hold block a new hold", async () => {
    state.fake!.bookings().push({
      id: "OLD00001",
      phone: "+353800000002",
      test_centre: "Tallaght",
      test_date: "2026-11-10",
      test_time: "10:30",
      status: "pending",
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    });
    const response = await handleBotEvent(
      await signedBotEventRequest(lockedEvent({ event_id: "e1" })),
    );
    expect(response.status).toBe(200);
    expect(state.fake!.bookings().find((row) => row.id === "OLD00001")?.status).toBe("expired");
    expect(state.fake!.bookings().filter((row) => row.status === "pending")).toHaveLength(1);
  });

  it("expired rows do not block", async () => {
    state.fake!.bookings().push({
      id: "OLD00002",
      test_centre: "Tallaght",
      test_date: "2026-11-10",
      test_time: "10:30",
      status: "expired",
      expires_at: new Date(0).toISOString(),
    });
    expect(
      (await handleBotEvent(await signedBotEventRequest(lockedEvent({ event_id: "e2" })))).status,
    ).toBe(200);
  });
});

describe("contract mismatches", () => {
  it("SLOT_LOCKED with a WhatsApp failure returns 202 and the pay link", async () => {
    sendWhatsAppText.mockRejectedValue(new Error("WhatsApp send failed (400)"));
    const response = await handleBotEvent(
      await signedBotEventRequest(lockedEvent({ event_id: "w1" })),
    );
    const body = await response.json();
    expect(response.status).toBe(202);
    expect(body.ok).toBe(true);
    expect(body.booking_id).toBeTruthy();
    expect(body.pay_url).toContain(`/pay/${body.booking_id}`);
    expect(String(body.whatsapp)).toContain("WhatsApp send failed");
  });

  it("rejects a body over 20 000 UTF-8 bytes even when the UTF-16 length is smaller", async () => {
    const big = lockedEvent({ event_id: "big", reference: undefined, pad: "é".repeat(15_000) });
    const raw = JSON.stringify(big);
    expect(raw.length).toBeLessThan(20_000);
    expect(new TextEncoder().encode(raw).length).toBeGreaterThan(20_000);
    const response = await handleBotEvent(await rawReq(raw));
    expect(response.status).toBe(413);
    expect(state.fake!.bookings()).toHaveLength(0);
  });

  it("missing secret and an empty secret both return 503", async () => {
    process.env["BOT_WEBHOOK_SECRET"] = "";
    expect((await handleBotEvent(await signedBotEventRequest(lockedEvent()))).status).toBe(503);
    delete process.env["BOT_WEBHOOK_SECRET"];
    expect(
      (await handleBotEvent(await signedBotEventRequest(lockedEvent({ event_id: "nosecret" }))))
        .status,
    ).toBe(503);
  });

  it("refuses to build a pay link from the request host when PUBLIC_SITE_URL is unset", async () => {
    delete process.env["PUBLIC_SITE_URL"];
    const response = await handleBotEvent(
      await signedBotEventRequest(lockedEvent({ event_id: "nourl" })),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false, reason: "not_configured" });
    expect(state.fake!.bookings()).toHaveLength(0);
    expect(state.fake!.events()).toHaveLength(0);
  });
});
