import { describe, it, expect } from "vitest";
import {
  REFUND_COMPLETION_LIMIT,
  REFUND_WATCH_LIMIT_SECONDS,
  REFUND_WINDOW_DAYS,
  checkRefundEligibility,
  lastDayOfRefundWindow,
  type RefundFacts,
} from "./refunds";

// Local-time constructor, so "the day of purchase" is the same calendar day
// the rules see, whatever timezone the tests run in.
function at(year: number, month: number, day: number, hour = 12) {
  return new Date(year, month - 1, day, hour);
}

const PURCHASED_AT = at(2026, 3, 1, 23);
const DAY_AFTER = at(2026, 3, 2);

function eligibleFacts(overrides: Partial<RefundFacts> = {}): RefundFacts {
  return {
    purchasedAt: PURCHASED_AT.toISOString(),
    amountPaid: 4900,
    secondsWatched: 0,
    completedLessonCount: 0,
    lessonCount: 10,
    hasClaimedTeamSeat: false,
    hasOpenRefundRequest: false,
    hasApprovedRefundRequest: false,
    ...overrides,
  };
}

describe("refund rules", () => {
  it("pins the published limits", () => {
    expect(REFUND_WINDOW_DAYS).toBe(14);
    expect(REFUND_WATCH_LIMIT_SECONDS).toBe(2 * 60 * 60);
    expect(REFUND_COMPLETION_LIMIT).toBe(0.5);
  });

  describe("lastDayOfRefundWindow", () => {
    it("is the 14th calendar day after the day of purchase", () => {
      expect(lastDayOfRefundWindow(PURCHASED_AT.toISOString())).toBe(
        "2026-03-15"
      );
    });
  });

  describe("checkRefundEligibility", () => {
    it("is eligible for a fresh purchase, for the full amount paid", () => {
      expect(checkRefundEligibility(eligibleFacts(), DAY_AFTER)).toEqual({
        eligible: true,
        refundAmount: 4900,
        lastDayOfWindow: "2026-03-15",
      });
    });

    it("refunds what was paid, whatever it was", () => {
      const result = checkRefundEligibility(
        eligibleFacts({ amountPaid: 1234 }),
        DAY_AFTER
      );
      expect(result).toMatchObject({ eligible: true, refundAmount: 1234 });
    });

    describe("the refund window", () => {
      it("still includes the whole of the 14th day", () => {
        const result = checkRefundEligibility(
          eligibleFacts(),
          at(2026, 3, 15, 23)
        );
        expect(result.eligible).toBe(true);
      });

      it("has closed on the 15th day", () => {
        expect(
          checkRefundEligibility(eligibleFacts(), at(2026, 3, 16, 0))
        ).toEqual({ eligible: false, reason: "window-closed" });
      });

      it("has not opened before the day of purchase", () => {
        expect(
          checkRefundEligibility(eligibleFacts(), at(2026, 2, 28))
        ).toEqual({ eligible: false, reason: "window-closed" });
      });
    });

    it("refuses once the watch-time limit is reached", () => {
      expect(
        checkRefundEligibility(
          eligibleFacts({ secondsWatched: REFUND_WATCH_LIMIT_SECONDS }),
          DAY_AFTER
        )
      ).toEqual({ eligible: false, reason: "watched-too-much" });
    });

    it("allows watch time just under the limit", () => {
      const result = checkRefundEligibility(
        eligibleFacts({ secondsWatched: REFUND_WATCH_LIMIT_SECONDS - 1 }),
        DAY_AFTER
      );
      expect(result.eligible).toBe(true);
    });

    it("refuses once half the lessons are completed", () => {
      expect(
        checkRefundEligibility(
          eligibleFacts({ completedLessonCount: 5, lessonCount: 10 }),
          DAY_AFTER
        )
      ).toEqual({ eligible: false, reason: "completed-too-much" });
    });

    it("allows completion just under half", () => {
      const result = checkRefundEligibility(
        eligibleFacts({ completedLessonCount: 4, lessonCount: 10 }),
        DAY_AFTER
      );
      expect(result.eligible).toBe(true);
    });

    it("ignores completion for a course with no lessons", () => {
      const result = checkRefundEligibility(
        eligibleFacts({ completedLessonCount: 0, lessonCount: 0 }),
        DAY_AFTER
      );
      expect(result.eligible).toBe(true);
    });

    it("refuses a purchase with a claimed team seat", () => {
      expect(
        checkRefundEligibility(
          eligibleFacts({ hasClaimedTeamSeat: true }),
          DAY_AFTER
        )
      ).toEqual({ eligible: false, reason: "claimed-team-seat" });
    });

    it("refuses while a Refund Request is already open", () => {
      expect(
        checkRefundEligibility(
          eligibleFacts({ hasOpenRefundRequest: true }),
          DAY_AFTER
        )
      ).toEqual({ eligible: false, reason: "already-open" });
    });

    it("refuses a purchase whose Refund Request was already approved", () => {
      expect(
        checkRefundEligibility(
          eligibleFacts({ hasApprovedRefundRequest: true }),
          DAY_AFTER
        )
      ).toEqual({ eligible: false, reason: "already-refunded" });
    });
  });
});
