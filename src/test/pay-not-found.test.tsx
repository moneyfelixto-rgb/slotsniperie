import { isNotFound } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getBooking = vi.hoisted(() => vi.fn());

vi.mock("@/lib/bookings.functions", () => ({
  getBooking,
}));

import { BookingNotFound } from "@/components/pay-page";
import { loadPayPage } from "@/lib/load-pay-page";
import { Route } from "@/routes/pay.$id";

describe("/pay/:id unknown booking", () => {
  beforeEach(() => {
    getBooking.mockReset();
    getBooking.mockResolvedValue(null);
  });

  it("wires /pay/:id to the not-found loader", () => {
    expect(String(Route.options.loader)).toContain("loadPayPage");
  });

  it("returns not-found for an unknown id", async () => {
    await expect(loadPayPage("AB12CD34")).rejects.toSatisfy(isNotFound);
    expect(getBooking).toHaveBeenCalledWith({ data: { id: "AB12CD34" } });
  });

  it("returns not-found for a malformed id without reading a booking", async () => {
    await expect(loadPayPage("no")).rejects.toSatisfy(isNotFound);
    expect(getBooking).not.toHaveBeenCalled();
  });

  it("renders a not-found page instead of a demo booking", () => {
    render(<BookingNotFound />);
    expect(screen.getByRole("heading", { name: /booking not found/i })).toBeInTheDocument();
    expect(screen.queryByText(/finglas/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/slot confirmed/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /pay/i })).not.toBeInTheDocument();
  });
});
