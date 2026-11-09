// ─── Refund Requests ───
// Everything that reads or changes Refund Requests in the database: the facts
// eligibility depends on, raising, withdrawing, and an Admin's decision.
// The rules themselves live in `refunds.ts`. Terms follow GLOSSARY.md.

import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "~/db";
import {
  coupons,
  courses,
  enrollments,
  lessonProgress,
  lessons,
  LessonProgressStatus,
  modules,
  purchases,
  refunds,
  RefundStatus,
  users,
  videoWatchEvents,
} from "~/db/schema";
import { checkRefundEligibility, type RefundEligibility } from "./refunds";

export type Purchase = typeof purchases.$inferSelect;
export type RefundRequest = typeof refunds.$inferSelect;

// ─── Facts ───

function getLatestPurchase(learnerId: number, courseId: number) {
  return db
    .select()
    .from(purchases)
    .where(
      and(eq(purchases.userId, learnerId), eq(purchases.courseId, courseId))
    )
    .orderBy(sql`${purchases.createdAt} desc`)
    .get();
}

function getLessonIdsForCourse(courseId: number): number[] {
  return db
    .select({ id: lessons.id })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(eq(modules.courseId, courseId))
    .all()
    .map((row) => row.id);
}

function hasRefundRequestWithStatus(purchaseId: number, status: RefundStatus) {
  const row = db
    .select({ id: refunds.id })
    .from(refunds)
    .where(and(eq(refunds.purchaseId, purchaseId), eq(refunds.status, status)))
    .get();
  return row !== undefined;
}

function hasClaimedTeamSeat(purchaseId: number): boolean {
  const row = db
    .select({ id: coupons.id })
    .from(coupons)
    .where(
      and(eq(coupons.purchaseId, purchaseId), isNotNull(coupons.redeemedAt))
    )
    .get();
  return row !== undefined;
}

function getCompletedLessonCount(learnerId: number, lessonIds: number[]) {
  if (lessonIds.length === 0) return 0;

  const result = db
    .select({ count: sql<number>`count(*)` })
    .from(lessonProgress)
    .where(
      and(
        eq(lessonProgress.userId, learnerId),
        eq(lessonProgress.status, LessonProgressStatus.Completed),
        inArray(lessonProgress.lessonId, lessonIds)
      )
    )
    .get();

  return result?.count ?? 0;
}

function getSecondsWatched(learnerId: number, lessonIds: number[]) {
  if (lessonIds.length === 0) return 0;

  const furthestPerLesson = db
    .select({
      furthest: sql<number>`max(${videoWatchEvents.positionSeconds})`,
    })
    .from(videoWatchEvents)
    .where(
      and(
        eq(videoWatchEvents.userId, learnerId),
        inArray(videoWatchEvents.lessonId, lessonIds)
      )
    )
    .groupBy(videoWatchEvents.lessonId)
    .all();

  return furthestPerLesson.reduce((total, row) => total + row.furthest, 0);
}

export type CourseUsage = {
  secondsWatched: number;
  completedLessonCount: number;
  lessonCount: number;
};

/** How much of a course a learner has used — shown to Admins on each request. */
export function getCourseUsage(
  learnerId: number,
  courseId: number
): CourseUsage {
  const lessonIds = getLessonIdsForCourse(courseId);
  return {
    secondsWatched: getSecondsWatched(learnerId, lessonIds),
    completedLessonCount: getCompletedLessonCount(learnerId, lessonIds),
    lessonCount: lessonIds.length,
  };
}

export type LearnerRefundEligibility =
  { purchase: null } | { purchase: Purchase; eligibility: RefundEligibility };

/**
 * Whether a learner may raise a Refund Request on their latest purchase of a
 * course, or `purchase: null` if they have never bought it.
 */
export function getRefundEligibility(
  learnerId: number,
  courseId: number
): LearnerRefundEligibility {
  const purchase = getLatestPurchase(learnerId, courseId);
  if (!purchase) return { purchase: null };

  const eligibility = checkRefundEligibility({
    purchasedAt: purchase.createdAt,
    amountPaid: purchase.amountPaid,
    ...getCourseUsage(learnerId, courseId),
    hasClaimedTeamSeat: hasClaimedTeamSeat(purchase.id),
    hasOpenRefundRequest: hasRefundRequestWithStatus(
      purchase.id,
      RefundStatus.Open
    ),
    hasApprovedRefundRequest: hasRefundRequestWithStatus(
      purchase.id,
      RefundStatus.Approved
    ),
  });

  return { purchase, eligibility };
}

/**
 * The learner's Open Refund Request for a course, if they have one. While it
 * exists their access to the course is paused (see ADR 0001).
 */
export function getOpenRefundRequestForCourse(
  learnerId: number,
  courseId: number
): RefundRequest | undefined {
  return db
    .select({ refund: refunds })
    .from(refunds)
    .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
    .where(
      and(
        eq(purchases.userId, learnerId),
        eq(purchases.courseId, courseId),
        eq(refunds.status, RefundStatus.Open)
      )
    )
    .get()?.refund;
}

// ─── Changes ───

export function raiseRefundRequest(purchaseId: number, reason: string) {
  db.insert(refunds)
    .values({ purchaseId, status: RefundStatus.Open, reason })
    .run();
}

/**
 * The learner takes back their own Open Refund Request. Returns false if it
 * was not theirs or no longer Open.
 */
export function withdrawRefundRequest(
  refundRequestId: number,
  learnerId: number
): boolean {
  const owned = db
    .select({ id: refunds.id })
    .from(refunds)
    .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
    .where(
      and(eq(refunds.id, refundRequestId), eq(purchases.userId, learnerId))
    )
    .get();
  if (!owned) return false;

  const result = db
    .update(refunds)
    .set({
      status: RefundStatus.Withdrawn,
      resolvedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(refunds.id, refundRequestId),
        eq(refunds.status, RefundStatus.Open)
      )
    )
    .run();
  return result.changes > 0;
}

export type RefundDecision =
  | { decision: "approve"; note: string | null }
  | { decision: "decline"; note: string };

/**
 * An Admin approves or declines an Open Refund Request. Approving records the
 * Refund as the full amount paid and ends the learner's enrollment; their
 * progress and watch history stay. Returns the decided request, or null if it
 * was no longer Open.
 */
export function decideRefundRequest(
  refundRequestId: number,
  adminId: number,
  decision: RefundDecision
) {
  return db.transaction((tx) => {
    const row = tx
      .select({ refund: refunds, purchase: purchases })
      .from(refunds)
      .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
      .where(
        and(
          eq(refunds.id, refundRequestId),
          eq(refunds.status, RefundStatus.Open)
        )
      )
      .get();
    if (!row) return null;

    const approved = decision.decision === "approve";

    tx.update(refunds)
      .set({
        status: approved ? RefundStatus.Approved : RefundStatus.Declined,
        amountRefunded: approved ? row.purchase.amountPaid : null,
        decisionNote: decision.note,
        resolvedAt: new Date().toISOString(),
        resolvedByUserId: adminId,
      })
      .where(eq(refunds.id, refundRequestId))
      .run();

    if (approved) {
      tx.delete(enrollments)
        .where(
          and(
            eq(enrollments.userId, row.purchase.userId),
            eq(enrollments.courseId, row.purchase.courseId)
          )
        )
        .run();
    }

    return row.purchase;
  });
}

// ─── Admin screen ───

export type RefundRequestSummary = {
  id: number;
  status: RefundStatus;
  reason: string;
  decisionNote: string | null;
  requestedAt: string;
  resolvedAt: string | null;
};

export type RefundRequestRow = RefundRequestSummary & {
  amountPaid: number;
  amountRefunded: number | null;
  purchasedAt: string;
  learner: { id: number; name: string; email: string };
  course: { id: number; title: string; slug: string };
  decidedBy: string | null;
  usage: CourseUsage;
  earlierRequests: RefundRequestSummary[];
};

const summaryColumns = {
  id: refunds.id,
  status: refunds.status,
  reason: refunds.reason,
  decisionNote: refunds.decisionNote,
  requestedAt: refunds.requestedAt,
  resolvedAt: refunds.resolvedAt,
};

/**
 * Refund Requests with one status, for the Admin screen. Open ones come oldest
 * first (a queue); decided ones newest first (a history).
 */
export function listRefundRequests(status: RefundStatus): RefundRequestRow[] {
  const rows = db
    .select({
      ...summaryColumns,
      purchaseId: refunds.purchaseId,
      amountRefunded: refunds.amountRefunded,
      resolvedByUserId: refunds.resolvedByUserId,
      amountPaid: purchases.amountPaid,
      purchasedAt: purchases.createdAt,
      learnerId: users.id,
      learnerName: users.name,
      learnerEmail: users.email,
      courseId: courses.id,
      courseTitle: courses.title,
      courseSlug: courses.slug,
    })
    .from(refunds)
    .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
    .innerJoin(users, eq(purchases.userId, users.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .where(eq(refunds.status, status))
    .orderBy(
      status === RefundStatus.Open
        ? asc(refunds.requestedAt)
        : desc(refunds.requestedAt)
    )
    .all();

  if (rows.length === 0) return [];

  const purchaseIds = [...new Set(rows.map((row) => row.purchaseId))];
  const allForPurchases = db
    .select({ ...summaryColumns, purchaseId: refunds.purchaseId })
    .from(refunds)
    .where(inArray(refunds.purchaseId, purchaseIds))
    .orderBy(asc(refunds.requestedAt))
    .all();

  const adminIds = rows
    .map((row) => row.resolvedByUserId)
    .filter((id): id is number => id !== null);
  const adminNames = new Map(
    adminIds.length === 0
      ? []
      : db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(inArray(users.id, adminIds))
          .all()
          .map((admin) => [admin.id, admin.name])
  );

  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    reason: row.reason,
    decisionNote: row.decisionNote,
    requestedAt: row.requestedAt,
    resolvedAt: row.resolvedAt,
    amountPaid: row.amountPaid,
    amountRefunded: row.amountRefunded,
    purchasedAt: row.purchasedAt,
    learner: {
      id: row.learnerId,
      name: row.learnerName,
      email: row.learnerEmail,
    },
    course: { id: row.courseId, title: row.courseTitle, slug: row.courseSlug },
    decidedBy:
      row.resolvedByUserId === null
        ? null
        : (adminNames.get(row.resolvedByUserId) ?? null),
    usage: getCourseUsage(row.learnerId, row.courseId),
    earlierRequests: allForPurchases
      .filter(
        (other) =>
          other.purchaseId === row.purchaseId &&
          other.id !== row.id &&
          other.requestedAt < row.requestedAt
      )
      .map(({ purchaseId: _purchaseId, ...summary }) => summary),
  }));
}

/** How many Refund Requests have each status — for the tab counts. */
export function countRefundRequestsByStatus(): Record<RefundStatus, number> {
  const counts: Record<RefundStatus, number> = {
    [RefundStatus.Open]: 0,
    [RefundStatus.Approved]: 0,
    [RefundStatus.Declined]: 0,
    [RefundStatus.Withdrawn]: 0,
  };
  const rows = db
    .select({ status: refunds.status, count: sql<number>`count(*)` })
    .from(refunds)
    .groupBy(refunds.status)
    .all();
  for (const row of rows) counts[row.status] = row.count;
  return counts;
}
