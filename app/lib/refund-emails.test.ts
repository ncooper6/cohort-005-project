import { describe, it, expect } from "vitest";
import {
  buildRefundRequestApprovedEmail,
  buildRefundRequestDeclinedEmail,
  buildRefundRequestRaisedEmail,
} from "./refund-emails";

const learner = { name: "Liam", email: "liam@example.com" };

describe("refund emails", () => {
  it("confirms a raised Refund Request and says access is paused", () => {
    const email = buildRefundRequestRaisedEmail({
      learner,
      courseTitle: "Intro to TS",
      refundAmount: 7900,
    });
    expect(email.to).toBe("liam@example.com");
    expect(email.subject).toBe("Refund requested — Intro to TS");
    expect(email.body).toContain("$79.00");
    expect(email.body).toContain("paused");
  });

  it("tells the learner their Refund Request was approved, with the amount", () => {
    const email = buildRefundRequestApprovedEmail({
      learner,
      courseTitle: "Intro to TS",
      refundAmount: 7900,
    });
    expect(email.subject).toBe("Refund approved — Intro to TS");
    expect(email.body).toContain("$79.00");
  });

  it("gives the Admin's reason when a Refund Request is declined", () => {
    const email = buildRefundRequestDeclinedEmail({
      learner,
      courseTitle: "Intro to TS",
      decisionNote: "You finished most of the course before asking.",
    });
    expect(email.subject).toBe("Refund declined — Intro to TS");
    expect(email.body).toContain(
      "You finished most of the course before asking."
    );
    expect(email.body).toContain("access");
  });
});
