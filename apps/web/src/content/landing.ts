export const plans = [
  {
    name: 'Plus',
    monthly: 499,
    annual: 4799,
    description: 'Best for professionals focused on one main career direction.',
    features: [
      '1 career profile and 2 sub-careers',
      '15-minute source scan target',
      '40 automatic Application Packs monthly',
      'Email alerts, core analysis, and application tracking',
    ],
  },
  {
    name: 'Pro',
    monthly: 999,
    annual: 9599,
    description:
      'Best for active applicants or professionals exploring multiple career directions.',
    features: [
      '3 career profiles and 5 sub-careers per profile',
      '5-minute source scan target',
      '100 automatic Application Packs monthly',
      'Advanced analysis, interview preparation, and future mobile access',
    ],
  },
] as const;

export const principles = [
  [
    'Truth before persuasion',
    'Hanaply never invents skills, experience, or career facts to make an application sound stronger.',
  ],
  [
    'Explainable matching',
    'Every recommendation should show why a role fits, where the gaps are, and what deserves attention.',
  ],
  [
    'You review every application',
    'Hanaply prepares the work, but never submits an application or contacts an employer for you.',
  ],
  [
    'Private career documents',
    'Your profile, resume, and application materials are treated as private career information.',
  ],
  [
    'Server-side account security',
    'Account access and sensitive operations are handled through protected server-side controls.',
  ],
  [
    'Clear product status',
    'Available, in-development, and planned capabilities are labeled so expectations stay honest.',
  ],
  [
    'Fewer, better opportunities',
    'The product is designed to reduce noise and focus your energy on roles that match your direction.',
  ],
  [
    'Accessible by design',
    'Important information stays understandable and usable with a keyboard and without animation.',
  ],
] as const;

export const productStatus = [
  { feature: 'Account foundation', status: 'Complete' },
  { feature: 'Activation Center', status: 'In development' },
  { feature: 'Career intelligence', status: 'Coming next' },
] as const;

export const faqItems = [
  {
    question: 'Is Hanaply a job board?',
    answer:
      'Hanaply is designed as a career system, not another endless listing board. It will connect a trusted Career Profile with explainable opportunity matching and truthful application preparation.',
  },
  {
    question: 'Does Hanaply apply to jobs automatically?',
    answer:
      'No. Hanaply will prepare materials for your review. You decide what to use and submit it through the employer’s application process.',
  },
  {
    question: 'Will AI invent experience for my resume?',
    answer:
      'No. Truth Gate is designed to block unsupported claims and keep generated materials grounded in career facts you provide and verify.',
  },
  {
    question: 'How will Hanaply decide whether a role matches me?',
    answer:
      'Career Radar will evaluate role requirements against verified experience, skills, projects, preferences, and hard constraints. It will explain strengths, gaps, and blockers instead of showing only a score.',
  },
  {
    question: 'Can I review every document before using it?',
    answer:
      'Yes. User review is a required part of the planned Application Pack flow. Hanaply will not submit a resume, cover letter, message, or application automatically.',
  },
  {
    question: 'Can Hanaply support career changes?',
    answer:
      'That is part of the planned product design. Transferable evidence and learnable gaps will help explain realistic transitions without pretending that every gap is easy to close.',
  },
  {
    question: 'Are subscriptions automatically renewed?',
    answer:
      'No. Hanaply uses manual renewals. Where an administrator has configured an available payment method, you can submit payment details and private proof in the Activation Center; paid access begins only after an authorized review.',
  },
  {
    question: 'Is Hanaply only for users in the Philippines?',
    answer:
      'The Philippines is the first launch market. Hanaply is being designed so the product can support professionals and opportunities in more markets over time.',
  },
  {
    question: 'Will there be an iOS or Android app?',
    answer:
      'Mobile applications are part of the future product roadmap. The web experience is being built first, and no iOS or Android app is available now.',
  },
  {
    question: 'Is the complete Hanaply product already available?',
    answer:
      'No. Account registration, account controls, and the manual-payment Activation Center checkpoint are implemented in the current web release. Career Profile, Career Radar, Truth Gate, Application Packs, job discovery, and mobile remain deferred.',
  },
] as const;

export const roadmap = [
  { id: 'phase-0', number: '00', status: 'Available now', title: 'Secure account creation' },
  {
    id: 'phase-1',
    number: '01',
    status: 'Available now',
    title: 'Account and profile controls',
  },
  {
    id: 'phase-2',
    number: '02',
    status: 'In progress',
    title: 'Plan activation and career profile',
  },
  { id: 'phase-3', number: '03', status: 'Planned', title: 'Opportunity discovery' },
  { id: 'phase-4', number: '04', status: 'Planned', title: 'Explainable intelligence' },
  { id: 'phase-5', number: '05', status: 'Planned', title: 'Notifications and strategy' },
  { id: 'phase-6', number: '06', status: 'Planned', title: 'Mobile experience' },
] as const;
