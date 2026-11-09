// ─── Refund Rules ───
// Whether a learner may raise a Refund Request, and how much the Refund would
// be, defined once. The course page (which decides whether to offer it) and the
// refund action (which records it) must agree, so both go through
// `checkRefundEligibility`.
//
// Pure: nothing here may touch the database or the request. The facts are
// gathered in `refunds.server.ts`. Terms follow GLOSSARY.md.

export const REFUND_WINDOW_DAYS = 14;
export const REFUND_WATCH_LIMIT_SECONDS = 2 * 60 * 60;
export const REFUND_COMPLETION_LIMIT = 0.5;

/** Everything the rules need to know about one learner's purchase. */
export type RefundFacts = {
  purchasedAt: string;
  amountPaid: number;
  secondsWatched: number;
  completedLessonCount: number;
  lessonCount: number;
  hasClaimedTeamSeat: boolean;
  hasOpenRefundRequest: boolean;
  hasApprovedRefundRequest: boolean;
};

export type RefundIneligibleReason =
  | "already-open"
  | "already-refunded"
  | "claimed-team-seat"
  | "window-closed"
  | "watched-too-much"
  | "completed-too-much";

export type RefundEligibility =
  | { eligible: true; refundAmount: number; lastDayOfWindow: string }
  | { eligible: false; reason: RefundIneligibleReason };

// The refund window is counted in whole calendar days, not hours — a learner
// who buys at 23:00 still gets the whole of their fourteenth day.
function calendarDay(when: Date): string {
  const month = String(when.getMonth() + 1).padStart(2, "0");
  const day = String(when.getDate()).padStart(2, "0");
  return `${when.getFullYear()}-${month}-${day}`;
}

/** The last calendar day (YYYY-MM-DD) on which a Refund Request can be raised. */
export function lastDayOfRefundWindow(purchasedAt: string): string {
  const deadline = new Date(purchasedAt);
  deadline.setDate(deadline.getDate() + REFUND_WINDOW_DAYS);
  return calendarDay(deadline);
}

/**
 * Checked every time a learner raises a Refund Request — including after
 * withdrawing one — so withdrawing and asking again can never get round the
 * limits.
 */
export function checkRefundEligibility(
  facts: RefundFacts,
  now: Date = new Date()
): RefundEligibility {
  if (facts.hasApprovedRefundRequest) {
    return { eligible: false, reason: "already-refunded" };
  }

  if (facts.hasOpenRefundRequest) {
    return { eligible: false, reason: "already-open" };
  }

  // A seat from a team purchase that has been claimed belongs to the team —
  // the purchasing learner cannot hand it back on their own.
  if (facts.hasClaimedTeamSeat) {
    return { eligible: false, reason: "claimed-team-seat" };
  }

  const today = calendarDay(now);
  const lastDayOfWindow = lastDayOfRefundWindow(facts.purchasedAt);
  const purchaseDay = calendarDay(new Date(facts.purchasedAt));

  if (today < purchaseDay || today > lastDayOfWindow) {
    return { eligible: false, reason: "window-closed" };
  }

  if (facts.secondsWatched >= REFUND_WATCH_LIMIT_SECONDS) {
    return { eligible: false, reason: "watched-too-much" };
  }

  if (
    facts.lessonCount > 0 &&
    facts.completedLessonCount / facts.lessonCount >= REFUND_COMPLETION_LIMIT
  ) {
    return { eligible: false, reason: "completed-too-much" };
  }

  // A Refund is always the full amount the learner paid.
  return { eligible: true, refundAmount: facts.amountPaid, lastDayOfWindow };
}
