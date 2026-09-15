export const testAccounts = Object.freeze({
  customer: {
    email: 'phase1.customer@hanaply.test',
    password: 'Hanaply-Customer-2026!',
  },
  admin: {
    email: 'phase1.admin@hanaply.test',
    password: 'Hanaply-Admin-2026!',
  },
  suspended: {
    email: 'phase1.suspended@hanaply.test',
    password: 'Hanaply-Suspended-2026!',
  },
  recovery: {
    email: 'phase1.recovery@hanaply.test',
    password: 'Hanaply-Recovery-2026!',
  },
  managed: {
    email: 'phase1.managed@hanaply.test',
    password: 'Hanaply-Managed-2026!',
  },
  registration: {
    email: 'phase1.registration@hanaply.test',
    password: 'Hanaply-Register-2026!',
  },
  /**
   * The product fixtures below exist because the product surfaces mutate state
   * that is scoped to one account: a Plus plan allows exactly one career
   * profile, a tracker row and an Application Pack belong to one member, and the
   * Usage counter is per user. Two spec files sharing one login would race on
   * that state, so each product area gets its own member.
   */
  career: {
    email: 'phase1.career@hanaply.test',
    password: 'Hanaply-Career-2026!',
  },
  radar: {
    email: 'phase1.radar@hanaply.test',
    password: 'Hanaply-Radar-2026!',
  },
  payments: {
    email: 'phase1.payments@hanaply.test',
    password: 'Hanaply-Payments-2026!',
  },
  /** Pro, because the coach is metered against `advancedAiAnalysis`. */
  coach: {
    email: 'phase1.coach@hanaply.test',
    password: 'Hanaply-Coach-2026!',
  },
  /** Owns the Application Pack and tracker state. */
  packs: {
    email: 'phase1.packs@hanaply.test',
    password: 'Hanaply-Packs-2026!',
  },
  /**
   * Owns the end-to-end matching fixture: the career profile the worker scores
   * and the opportunity `matching.spec.ts` follows from ingestion to the
   * browser. It is separate from the radar account because that spec asserts the
   * analysed feed for its own member, and two files writing matches for one
   * account would make each one's expectations depend on the other's run.
   */
  matching: {
    email: 'phase1.matching@hanaply.test',
    password: 'Hanaply-Matching-2026!',
  },
});
