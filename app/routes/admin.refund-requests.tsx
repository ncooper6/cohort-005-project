import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { toast } from "sonner";
import { z } from "zod";
import type { Route } from "./+types/admin.refund-requests";
import { getCurrentUserId } from "~/lib/session";
import { parseFormData } from "~/lib/validation";
import { db } from "~/db";
import { courses, RefundStatus, UserRole, users } from "~/db/schema";
import { eq } from "drizzle-orm";
import { Card, CardContent } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { AlertTriangle, ReceiptText } from "lucide-react";
import { data, isRouteErrorResponse, Link } from "react-router";
import { cn, formatPrice } from "~/lib/utils";
import {
  countRefundRequestsByStatus,
  decideRefundRequest,
  listRefundRequests,
  type RefundRequestRow,
  type RefundRequestSummary,
} from "~/lib/refunds.server";
import {
  buildRefundRequestApprovedEmail,
  buildRefundRequestDeclinedEmail,
  logEmail,
} from "~/lib/refund-emails";

// ─── Refund Requests (Admin) ───
// Where an Admin decides Open Refund Requests and looks back over decided and
// withdrawn ones. Terms follow GLOSSARY.md; the pause on access while a
// request is open is ADR 0001.

const TABS: { status: RefundStatus; label: string }[] = [
  { status: RefundStatus.Open, label: "Open" },
  { status: RefundStatus.Approved, label: "Approved" },
  { status: RefundStatus.Declined, label: "Declined" },
  { status: RefundStatus.Withdrawn, label: "Withdrawn" },
];

const statusParamSchema = z.nativeEnum(RefundStatus).catch(RefundStatus.Open);

const decisionSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("approve"),
    refundRequestId: z.coerce.number().int(),
  }),
  z.object({
    intent: z.literal("decline"),
    refundRequestId: z.coerce.number().int(),
    note: z
      .string()
      .trim()
      .min(10, "Tell the learner why their refund request was declined.")
      .max(1000, "Please keep the reason under 1000 characters."),
  }),
]);

function getUserById(id: number) {
  return db.select().from(users).where(eq(users.id, id)).get();
}

async function requireAdmin(request: Request) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("Select a user from the DevUI panel.", { status: 401 });
  }

  const currentUser = getUserById(currentUserId);

  if (!currentUser || currentUser.role !== UserRole.Admin) {
    throw data("Only admins can decide refund requests.", { status: 403 });
  }

  return currentUser;
}

export function meta() {
  return [{ title: "Refund Requests — Cadence" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);

  const status = statusParamSchema.parse(
    new URL(request.url).searchParams.get("status")
  );

  return {
    status,
    counts: countRefundRequestsByStatus(),
    refundRequests: listRefundRequests(status),
  };
}

export async function action({ request }: Route.ActionArgs) {
  const admin = await requireAdmin(request);

  const formData = await request.formData();
  const parsed = parseFormData(formData, decisionSchema);

  if (!parsed.success) {
    return data({ errors: parsed.errors }, { status: 400 });
  }

  const purchase = decideRefundRequest(
    parsed.data.refundRequestId,
    admin.id,
    parsed.data.intent === "approve"
      ? { decision: "approve", note: null }
      : { decision: "decline", note: parsed.data.note }
  );

  if (!purchase) {
    throw data("That refund request is no longer open.", { status: 409 });
  }

  const learner = getUserById(purchase.userId);
  const course = db
    .select()
    .from(courses)
    .where(eq(courses.id, purchase.courseId))
    .get();

  if (learner && course) {
    logEmail(
      parsed.data.intent === "approve"
        ? buildRefundRequestApprovedEmail({
            learner,
            courseTitle: course.title,
            refundAmount: purchase.amountPaid,
          })
        : buildRefundRequestDeclinedEmail({
            learner,
            courseTitle: course.title,
            decisionNote: parsed.data.note,
          })
    );
  }

  return { decided: parsed.data.intent };
}

function formatWatchTime(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString();
}

const STATUS_LABEL: Record<RefundStatus, string> = {
  [RefundStatus.Open]: "open",
  [RefundStatus.Approved]: "approved",
  [RefundStatus.Declined]: "declined",
  [RefundStatus.Withdrawn]: "withdrawn",
};

export default function AdminRefundRequests({
  loaderData,
}: Route.ComponentProps) {
  const { status, counts, refundRequests } = loaderData;

  return (
    <div className="mx-auto max-w-5xl p-6 lg:p-8">
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Refund Requests</span>
      </nav>

      <div className="mb-6">
        <h1 className="text-3xl font-bold">Refund Requests</h1>
        <p className="mt-1 text-muted-foreground">
          Approve or decline open refund requests. The learner's access is
          paused until you decide.
        </p>
      </div>

      <div className="mb-6 flex flex-wrap gap-1 border-b">
        {TABS.map((tab) => (
          <Link
            key={tab.status}
            to={`?status=${tab.status}`}
            className={cn(
              "-mb-px border-b-2 px-4 py-2 text-sm font-medium",
              tab.status === status
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
            <span className="ml-1.5 rounded-full bg-muted px-2 py-0.5 text-xs">
              {counts[tab.status]}
            </span>
          </Link>
        ))}
      </div>

      {refundRequests.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <ReceiptText className="mx-auto mb-3 size-8 text-muted-foreground/50" />
            <p className="text-muted-foreground">
              No {STATUS_LABEL[status]} refund requests.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {refundRequests.map((refundRequest) => (
            <RefundRequestCard
              key={refundRequest.id}
              refundRequest={refundRequest}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RefundRequestCard({
  refundRequest,
}: {
  refundRequest: RefundRequestRow;
}) {
  const { learner, course, usage } = refundRequest;
  const isOpen = refundRequest.status === RefundStatus.Open;

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link
              to={`/courses/${course.slug}`}
              className="font-semibold hover:underline"
            >
              {course.title}
            </Link>
            <p className="text-sm text-muted-foreground">
              {learner.name} · {learner.email}
            </p>
          </div>
          <div className="text-right">
            <p className="text-lg font-semibold">
              {formatPrice(refundRequest.amountPaid)}
            </p>
            <p className="text-xs text-muted-foreground">
              bought {formatDate(refundRequest.purchasedAt)}
            </p>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">Requested</dt>
            <dd>{formatDate(refundRequest.requestedAt)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Watched</dt>
            <dd>{formatWatchTime(usage.secondsWatched)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Lessons completed</dt>
            <dd>
              {usage.completedLessonCount} of {usage.lessonCount}
            </dd>
          </div>
        </dl>

        <div>
          <p className="text-sm text-muted-foreground">Learner's reason</p>
          <p className="mt-1 text-sm">{refundRequest.reason}</p>
        </div>

        {refundRequest.earlierRequests.length > 0 && (
          <EarlierRequests requests={refundRequest.earlierRequests} />
        )}

        {!isOpen && <Decision refundRequest={refundRequest} />}

        {isOpen && <DecisionControls refundRequestId={refundRequest.id} />}
      </CardContent>
    </Card>
  );
}

function EarlierRequests({ requests }: { requests: RefundRequestSummary[] }) {
  return (
    <div className="rounded-md border border-dashed p-3">
      <p className="text-sm font-medium">
        Earlier refund requests on this purchase ({requests.length})
      </p>
      <ul className="mt-2 space-y-2 text-sm">
        {requests.map((earlier) => (
          <li key={earlier.id}>
            <span className="font-medium capitalize">
              {STATUS_LABEL[earlier.status]}
            </span>{" "}
            <span className="text-muted-foreground">
              · requested {formatDate(earlier.requestedAt)}
            </span>
            <p className="text-muted-foreground">"{earlier.reason}"</p>
            {earlier.decisionNote && (
              <p className="text-muted-foreground">
                Admin: "{earlier.decisionNote}"
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Decision({ refundRequest }: { refundRequest: RefundRequestRow }) {
  const when = refundRequest.resolvedAt
    ? formatDate(refundRequest.resolvedAt)
    : null;

  return (
    <div className="rounded-md bg-muted p-3 text-sm">
      {refundRequest.status === RefundStatus.Withdrawn ? (
        <p>Withdrawn by the learner{when && ` on ${when}`}.</p>
      ) : (
        <p>
          <span className="font-medium capitalize">
            {STATUS_LABEL[refundRequest.status]}
          </span>
          {refundRequest.decidedBy && ` by ${refundRequest.decidedBy}`}
          {when && ` on ${when}`}
          {refundRequest.amountRefunded !== null &&
            ` · ${formatPrice(refundRequest.amountRefunded)} refunded`}
        </p>
      )}
      {refundRequest.decisionNote && (
        <p className="mt-1 text-muted-foreground">
          "{refundRequest.decisionNote}"
        </p>
      )}
    </div>
  );
}

function DecisionControls({ refundRequestId }: { refundRequestId: number }) {
  const fetcher = useFetcher<{
    errors?: Record<string, string>;
    decided?: "approve" | "decline";
  }>();
  const [isDeclining, setIsDeclining] = useState(false);
  const isSubmitting = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state !== "idle") return;
    const firstError = Object.values(fetcher.data?.errors ?? {})[0];
    if (firstError) toast.error(firstError);
    if (fetcher.data?.decided === "approve") {
      toast.success("Refund request approved.");
    }
    if (fetcher.data?.decided === "decline") {
      toast.success("Refund request declined.");
    }
  }, [fetcher.state, fetcher.data]);

  if (isDeclining) {
    return (
      <fetcher.Form method="post" className="space-y-2 border-t pt-4">
        <input type="hidden" name="intent" value="decline" />
        <input type="hidden" name="refundRequestId" value={refundRequestId} />
        <label
          className="text-sm font-medium"
          htmlFor={`note-${refundRequestId}`}
        >
          Why are you declining it? The learner will see this.
        </label>
        <Textarea
          id={`note-${refundRequestId}`}
          name="note"
          rows={3}
          required
          minLength={10}
        />
        <div className="flex gap-2">
          <Button
            type="submit"
            size="sm"
            variant="destructive"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Declining..." : "Decline refund request"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setIsDeclining(false)}
          >
            Back
          </Button>
        </div>
      </fetcher.Form>
    );
  }

  return (
    <div className="flex gap-2 border-t pt-4">
      <fetcher.Form method="post">
        <input type="hidden" name="intent" value="approve" />
        <input type="hidden" name="refundRequestId" value={refundRequestId} />
        <Button type="submit" size="sm" disabled={isSubmitting}>
          {isSubmitting ? "Approving..." : "Approve"}
        </Button>
      </fetcher.Form>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={isSubmitting}
        onClick={() => setIsDeclining(true)}
      >
        Decline
      </Button>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading refund requests.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 401) {
      title = "Sign in required";
      message =
        typeof error.data === "string"
          ? error.data
          : "Please select a user from the DevUI panel.";
    } else if (error.status === 403) {
      title = "Access denied";
      message =
        typeof error.data === "string"
          ? error.data
          : "Only admins can access this page.";
    } else {
      title = `Error ${error.status}`;
      message = typeof error.data === "string" ? error.data : error.statusText;
    }
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        <Link to="/">
          <Button>Go Home</Button>
        </Link>
      </div>
    </div>
  );
}
