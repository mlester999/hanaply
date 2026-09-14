/**
 * What a finished payment review action reports.
 *
 * The result has to survive the page it was produced on. Every review action
 * changes `payment.status`, and the review panel renders a different set of forms
 * for each status: claiming a review replaces "Start Review" with the decision
 * forms, and approving replaces those with the read-only state. A result kept in
 * the client component was therefore either unmounted with the card that raised
 * it, or — worse — still reported the *claim* after the approval had already
 * committed, so the reviewer was told the payment was under review while the
 * subscription was live.
 *
 * The message is derived from the submission's own append-only history instead.
 * `payment_submission_events` is written by the same database function that makes
 * the decision, so the newest event is what actually happened, and a result the
 * reviewer is shown can never describe something the database did not record.
 */
const outcomeForEvent: Readonly<Record<string, string>> = {
  'payment_submission.review_started': 'The review lock is assigned to you for 15 minutes.',
  'payment_submission.information_requested':
    'The information request was saved and queued for notification.',
  'payment_submission.rejected': 'The payment was rejected and the reason was recorded.',
  'payment_submission.refunded':
    'The external refund record and subscription impact were saved. No money was moved by Hanaply.',
  'payment_submission.reversed': 'The approval was reversed and its subscription access was ended.',
  'payment_submission.approved': 'Payment approved. Your subscription is active.',
};

/**
 * The sentence the newest review event stands for, or null when there is none.
 *
 * Only events a reviewer caused are reported. A submission the member has just
 * created or submitted is in the state its own page already describes, and
 * announcing it back to an administrator would be noise.
 */
export function paymentReviewOutcomeMessage(
  events: readonly { eventType: string }[],
): string | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const eventType = events[index]?.eventType;
    if (eventType === undefined) continue;
    const message = outcomeForEvent[eventType];
    if (message !== undefined) return message;
  }
  return null;
}
