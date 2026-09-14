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
  { feature: 'Account foundation', status: 'Available' },
  { feature: 'Activation Center', status: 'Available' },
  { feature: 'Career profile and resume review', status: 'Available' },
  { feature: 'Career Radar and job intelligence', status: 'Available' },
  { feature: 'Application Packs and tracker', status: 'In development' },
  { feature: 'Alerts, digest, and career coaching', status: 'In development' },
  { feature: 'Mobile experience', status: 'Planned' },
] as const;

export const faqItems = [
  {
    question: 'Is Hanaply a job board?',
    answer:
      'No. Hanaply connects your Career Profile to explainable opportunity matching and truthful application preparation, instead of leaving you to scroll an endless list of listings.',
  },
  {
    question: 'Does Hanaply apply to jobs automatically?',
    answer:
      'No. Hanaply prepares materials for your review. You decide what to use and submit it through the employer’s own application process, using the original posting link.',
  },
  {
    question: 'Will AI invent experience for my resume?',
    answer:
      'No. Every claim must trace back to a career fact you entered or confirmed. Resume extraction can only propose, never assert, and the database rejects generated material that cites a claim you have not confirmed.',
  },
  {
    question: 'How does Hanaply decide whether a role matches me?',
    answer:
      'Career Radar scores nine dimensions, including role alignment, skills coverage, seniority, experience, location and work setup, compensation, employment type, career direction, and freshness. You see every dimension, the strongest evidence, the gaps, and any hard blocker. When the data is too thin to judge a dimension, it is reported as unknown rather than guessed.',
  },
  {
    question: 'Can I review every document before using it?',
    answer:
      'Yes. User review is a required part of the Application Pack flow. Hanaply does not submit a resume, cover letter, message, or application for you.',
  },
  {
    question: 'Can Hanaply support career changes?',
    answer:
      'Yes. Requirements you do not meet are shown as explicit gaps, and where adjacent experience exists it is described as transferable rather than presented as direct experience.',
  },
  {
    question: 'Are subscriptions automatically renewed?',
    answer:
      'No. Hanaply uses manual renewals. Where an administrator has configured an available payment method, you can submit payment details and private proof in the Activation Center; paid access begins only after an authorized review.',
  },
  {
    question: 'Where do the job listings come from?',
    answer:
      'From job providers with published terms. Each source is catalogued with its attribution and usage terms and stays disabled until an operator reviews it, and Hanaply issues one shared scan per provider rather than a request per user.',
  },
  {
    question: 'Is Hanaply only for users in the Philippines?',
    answer:
      'The Philippines is the first launch market, and the product defaults to English, PHP, and Asia/Manila. Country, currency, timezone, and job-market preferences are configurable, so the same platform can serve other markets.',
  },
  {
    question: 'Will there be an iOS or Android app?',
    answer:
      'Mobile applications are part of the future product roadmap. The web experience is built first, the backend is mobile-ready, and no iOS or Android app is available now.',
  },
  {
    question: 'Is the complete Hanaply product already available?',
    answer:
      'Not entirely. Registration, account controls, the manual-payment Activation Center, the Career Intelligence Profile, resume upload with review, Career Radar, and explainable matching are implemented. Application Packs, the application tracker, alert delivery, coaching, and mobile remain in progress.',
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
    status: 'Available now',
    title: 'Plan activation and manual payments',
  },
  {
    id: 'phase-3',
    number: '03',
    status: 'Available now',
    title: 'Career profile, resume review, and verified facts',
  },
  {
    id: 'phase-4',
    number: '04',
    status: 'Available now',
    title: 'Job discovery, explainable matching, and the Career Radar',
  },
  {
    id: 'phase-5',
    number: '05',
    status: 'In progress',
    title: 'Application Packs and the application tracker',
  },
  {
    id: 'phase-6',
    number: '06',
    status: 'In progress',
    title: 'Alerts, digest, and career coaching',
  },
  { id: 'phase-7', number: '07', status: 'Planned', title: 'Mobile experience' },
] as const;
