import { data, redirect } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/courses.$slug.refund";
import { getCurrentUserId } from "~/lib/session";
import { db } from "~/db";
import { courses, users } from "~/db/schema";
import { eq } from "drizzle-orm";
import { parseFormData, parseParams } from "~/lib/validation";
import {
  REFUND_WINDOW_DAYS,
  type RefundIneligibleReason,
} from "~/lib/refunds";
import {
  getOpenRefundRequestForCourse,
  getRefundEligibility,
  raiseRefundRequest,
  withdrawRefundRequest,
} from "~/lib/refunds.server";
import { buildRefundRequestRaisedEmail, logEmail } from "~/lib/refund-emails";

const refundParamsSchema = z.object({
  slug: z.string().min(1),
});

const refundActionSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("raise"),
    reason: z
      .string()
      .trim()
      .min(10, "Tell us a little more about why you want a refund.")
      .max(1000, "Please keep your reason under 1000 characters."),
  }),
  z.object({ intent: z.literal("withdraw") }),
]);

const INELIGIBLE: Record<
  RefundIneligibleReason,
  { message: string; status: number }
> = {
  "already-open": {
    message: "You already have an open refund request on this purchase.",
    status: 409,
  },
  "already-refunded": {
    message: "This purchase has already been refunded.",
    status: 409,
  },
  "claimed-team-seat": {
    message: "A claimed team seat cannot be refunded.",
    status: 403,
  },
  "window-closed": {
    message: `The ${REFUND_WINDOW_DAYS}-day refund window has closed.`,
    status: 403,
  },
  "watched-too-much": {
    message: "You have watched too much of this course to request a refund.",
    status: 403,
  },
  "completed-too-much": {
    message: "You have completed too much of this course to request a refund.",
    status: 403,
  },
};

function getCourseBySlug(slug: string) {
  return db.select().from(courses).where(eq(courses.slug, slug)).get();
}

export async function action({ params, request }: Route.ActionArgs) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("Select a user from the DevUI panel.", { status: 401 });
  }

  const { slug } = parseParams(params, refundParamsSchema);
  const course = getCourseBySlug(slug);

  if (!course) {
    throw data("Course not found", { status: 404 });
  }

  const learner = db
    .select()
    .from(users)
    .where(eq(users.id, currentUserId))
    .get();

  if (!learner) {
    throw data("User not found", { status: 404 });
  }

  const formData = await request.formData();
  const parsed = parseFormData(formData, refundActionSchema);

  if (!parsed.success) {
    return data({ errors: parsed.errors }, { status: 400 });
  }

  if (parsed.data.intent === "withdraw") {
    const open = getOpenRefundRequestForCourse(currentUserId, course.id);
    if (!open || !withdrawRefundRequest(open.id, currentUserId)) {
      throw data("You have no open refund request for this course.", {
        status: 409,
      });
    }
    return { withdrawn: true };
  }

  const result = getRefundEligibility(currentUserId, course.id);

  if (!result.purchase) {
    throw data("You have not bought this course.", { status: 403 });
  }

  const { purchase, eligibility } = result;

  if (!eligibility.eligible) {
    const { message, status } = INELIGIBLE[eligibility.reason];
    throw data(message, { status });
  }

  raiseRefundRequest(purchase.id, parsed.data.reason);

  logEmail(
    buildRefundRequestRaisedEmail({
      learner,
      courseTitle: course.title,
      refundAmount: eligibility.refundAmount,
    })
  );

  return redirect("/settings");
}
