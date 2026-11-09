// The emails a learner gets as their Refund Request moves along. There is no
// mail transport wired up yet, so callers send the built message to the
// server log with `logEmail`. Withdrawing sends nothing — the learner did it.

import { formatPrice } from "./utils";

type Learner = { name: string; email: string };

export type Email = { to: string; subject: string; body: string };

const SIGN_OFF = ["", "— The Cadence team"];

export function buildRefundRequestRaisedEmail(input: {
  learner: Learner;
  courseTitle: string;
  refundAmount: number;
}): Email {
  return {
    to: input.learner.email,
    subject: `Refund requested — ${input.courseTitle}`,
    body: [
      `Hi ${input.learner.name},`,
      "",
      `We have your refund request for "${input.courseTitle}".`,
      `The refund is for ${formatPrice(input.refundAmount)}, the amount you paid.`,
      "",
      "An admin reviews every refund request by hand. While it is open, your access to the course is paused. If you change your mind, you can withdraw the request from the course page and your access comes straight back.",
      "",
      "We will email you again when it has been approved or declined.",
      ...SIGN_OFF,
    ].join("\n"),
  };
}

export function buildRefundRequestApprovedEmail(input: {
  learner: Learner;
  courseTitle: string;
  refundAmount: number;
}): Email {
  return {
    to: input.learner.email,
    subject: `Refund approved — ${input.courseTitle}`,
    body: [
      `Hi ${input.learner.name},`,
      "",
      `Your refund request for "${input.courseTitle}" has been approved.`,
      `We will send ${formatPrice(input.refundAmount)} back to the card you paid with. You no longer have access to the course.`,
      ...SIGN_OFF,
    ].join("\n"),
  };
}

export function buildRefundRequestDeclinedEmail(input: {
  learner: Learner;
  courseTitle: string;
  decisionNote: string;
}): Email {
  return {
    to: input.learner.email,
    subject: `Refund declined — ${input.courseTitle}`,
    body: [
      `Hi ${input.learner.name},`,
      "",
      `Your refund request for "${input.courseTitle}" has been declined. The admin who reviewed it said:`,
      "",
      `"${input.decisionNote}"`,
      "",
      "Your access to the course is back. If you are still within the refund window, you can raise a new request from the course page.",
      ...SIGN_OFF,
    ].join("\n"),
  };
}

export function logEmail(email: Email) {
  console.log(`[email] to=${email.to} subject=${email.subject}\n${email.body}`);
}
