import { testAccounts } from './accounts.js';
import { expect, signIn, test } from './product.js';

/**
 * The Career Profile is the source of truth every other product surface cites,
 * so these specs walk it the way a member does: onboarding first, then the
 * preferences form, the plan limits, every record kind, and finally a resume
 * whose extracted claims have to be confirmed before anything may cite them.
 *
 * One account owns the whole file. A Plus plan allows exactly one career
 * profile, so a second file sharing this login would race it.
 */
test.describe.configure({ mode: 'serial' });

const resumeFixture = [
  'Workflow Automation Engineer',
  'Manila, Philippines',
  '',
  'Summary',
  'Automation engineer focused on internal tooling for operations teams.',
  '',
  'Experience',
  'Workflow Automation Engineer at Northstar Systems',
  'January 2021 - Present',
  'Full time',
  'Remote',
  'Automated the order intake process and reduced manual handling time by 40 percent.',
  'Led a small engineering group through a queue-based workflow migration.',
  '',
  'Data Analyst at Meridian Support',
  'June 2018 - December 2020',
  'Contract',
  'Delivered weekly reporting for a support organisation of 60 people.',
  '',
  'Education',
  'BSc Information Technology, University of the Philippines',
  '2014 - 2018',
  '',
  'Skills',
  'TypeScript, Node.js, SQL, PostgreSQL, n8n, Supabase, Excel',
  '',
  'Certifications',
  'n8n Advanced Automation, n8n Academy',
].join('\n');

test('completes onboarding and creates the primary career profile', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, testAccounts.career);
  await page.goto('/dashboard/onboarding');
  await expect(
    page.getByRole('heading', { name: 'Career profile onboarding', level: 1 }),
  ).toBeVisible();

  // Opening the wizard creates the first profile and moves onboarding forward.
  // The warning is what the page shows until that has happened, so its
  // disappearance is the observable proof that the profile now exists — and the
  // step-1 save below cannot succeed at all without a profile id.
  await expect(page.getByText('No career profile exists yet')).toHaveCount(0);

  await page.locator('#onboardingCurrentRole').fill('Workflow Automation Engineer');
  await page.locator('#onboardingCareerLevel').selectOption('Mid level');
  await page.locator('#onboardingYears').fill('6');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  // Each step saves before it advances, so the advance is the success signal;
  // the step's own success alert unmounts with the step.
  await expect(page.getByRole('heading', { name: 'Target roles' })).toBeVisible();

  await page.locator('#onboardingTargetRoles').fill('Automation Engineer');
  await page.locator('#onboardingTargetRoles').press('Enter');
  await page.locator('#onboardingTargetRoles').fill('Solutions Engineer');
  await page.locator('#onboardingTargetRoles').press('Enter');
  await expect(page.getByRole('button', { name: 'Remove Automation Engineer' })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Full time' }).check();
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByRole('heading', { name: 'Skills' })).toBeVisible();
  // Each step saves to the profile before it advances, so the answers are
  // readable from the career hub even though the wizard keeps its step in the
  // browser.
  await page.goto('/dashboard/career');
  const profileCard = page.locator('.career-profile-card').first();
  await expect(profileCard.getByText('Automation Engineer, Solutions Engineer')).toBeVisible();
  await page.goto('/dashboard/onboarding');
  await page.getByRole('button', { name: '2 Target roles' }).click();
  await expect(page.getByRole('button', { name: 'Remove Automation Engineer' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Full time' })).toBeChecked();

  for (const step of ['3 Skills', '4 Experience', '5 Education and certifications']) {
    await page.getByRole('button', { name: step }).click();
  }
  await expect(page.getByRole('heading', { name: 'Education and certifications' })).toBeVisible();

  // Skills step: five skills is what the profile calls complete.
  await page.getByRole('button', { name: '3 Skills' }).click();
  for (const skill of ['TypeScript', 'SQL', 'n8n', 'Supabase', 'Node.js']) {
    await page.locator('#onboarding-skill-new-name').fill(skill);
    await page.locator('#onboarding-skill-new-skillKind').selectOption('Technology');
    await page.getByRole('button', { name: 'Add skill' }).click();
    await expect(page.getByRole('heading', { name: skill, level: 3 })).toBeVisible();
  }

  // Experience step.
  await page.getByRole('button', { name: '4 Experience' }).click();
  await page.locator('#onboarding-employment-new-roleTitle').fill('Workflow Automation Engineer');
  await page.locator('#onboarding-employment-new-companyName').fill('Northstar Systems');
  await page.locator('#onboarding-employment-new-startDate').fill('2021-01-01');
  await page.locator('#onboarding-employment-new-isCurrent').check();
  await page.getByRole('button', { name: 'Add employment' }).click();
  await expect(
    page.getByRole('heading', { name: 'Workflow Automation Engineer · Northstar Systems' }),
  ).toBeVisible();

  // Education and certification step.
  await page.getByRole('button', { name: '5 Education and certifications' }).click();
  await page.locator('#onboarding-education-new-institution').fill('University of the Philippines');
  await page.locator('#onboarding-education-new-degree').fill('BSc Information Technology');
  await page.locator('#onboarding-education-new-endYear').fill('2018');
  await page.getByRole('button', { name: 'Add education' }).click();
  await expect(
    page.getByRole('heading', { name: 'University of the Philippines', exact: true }),
  ).toBeVisible();
  await page.locator('#onboarding-certification-new-name').fill('n8n Advanced Automation');
  await page.locator('#onboarding-certification-new-issuer').fill('n8n Academy');
  await page.getByRole('button', { name: 'Add certification' }).click();
  await expect(page.getByRole('heading', { name: 'n8n Advanced Automation' })).toBeVisible();

  // Links and summary step.
  await page.getByRole('button', { name: '6 Links and summary' }).click();
  await page
    .locator('#onboardingSummary')
    .fill(
      'Automation engineer with six years of experience building internal tooling for operations teams.',
    );
  await page.locator('#onboardingGoals').fill('Move into a platform engineering role.');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByRole('heading', { name: 'Review' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to links and summary' }).click();
  await expect(page.locator('#onboardingSummary')).toHaveValue(
    'Automation engineer with six years of experience building internal tooling for operations teams.',
  );
  await page.locator('#onboarding-link-new-url').fill('https://github.com/hanaply-e2e');
  await page.getByRole('button', { name: 'Add link' }).click();
  await expect(page.getByText('https://github.com/hanaply-e2e')).toBeVisible();

  // Review step: the counts are read from the profile, not from this form.
  await page.getByRole('button', { name: '7 Review' }).click();
  await expect(
    page.getByRole('heading', { name: 'What is still missing, and what it costs' }),
  ).toBeVisible();
  const counts = page.locator('.career-count-list');
  await expect(counts.getByText('Skills')).toBeVisible();
  await expect(counts.locator('dd').nth(1)).toHaveText('5');

  await page.getByRole('button', { name: 'Finish onboarding' }).click();
  // Completion redirects into the career hub; the redirect is the success path,
  // so the assertion is the destination rather than an alert.
  await expect(page).toHaveURL('/dashboard/career');
  await expect(page.getByRole('heading', { name: 'Career profile', level: 1 })).toBeVisible();
  await expect(page.getByText('Profiles used')).toBeVisible();
  await expect(page.getByText('1 of 1')).toBeVisible();
});

test('edits career preferences and reports the recomputed completeness', async ({ page }) => {
  await signIn(page, testAccounts.career);
  await page.goto('/dashboard/career');
  await page.getByRole('link', { name: 'Open profile' }).first().click();

  const completeness = page.getByRole('progressbar').first();
  await expect(completeness).toBeVisible();
  const before = await completeness.getAttribute('aria-valuenow');

  await page.locator('#careerProfileHeadline').fill('Automation and platform engineer');
  await page.locator('#careerProfileAvailability').selectOption('Immediately');
  await page.locator('#careerSalaryMin').fill('90000');
  await page.locator('#careerSalaryMax').fill('120000');
  await page.locator('#careerSalaryPeriod').selectOption('Per month');
  await page.getByRole('checkbox', { name: 'Open to relocation' }).check();
  await page.locator('#careerProfileIndustries').fill('Financial technology');
  await page.locator('#careerProfileIndustries').press('Enter');
  await page.getByRole('button', { name: 'Save Profile' }).click();
  await expect(page.getByText('The career profile was updated.')).toBeVisible();

  await page.reload();
  await expect(page.locator('#careerProfileHeadline')).toHaveValue(
    'Automation and platform engineer',
  );
  await expect(page.locator('#careerProfileAvailability')).toHaveValue('immediately');
  await expect(page.locator('#careerSalaryMin')).toHaveValue('90000');
  await expect(page.getByRole('checkbox', { name: 'Open to relocation' })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Remove Financial technology' })).toBeVisible();

  const after = await page.getByRole('progressbar').first().getAttribute('aria-valuenow');
  expect(Number(after)).toBeGreaterThanOrEqual(Number(before));
});

test('enforces the career-profile limit and the sub-career limit for the plan', async ({
  page,
}) => {
  await signIn(page, testAccounts.career);
  await page.goto('/dashboard/career');

  await expect(page.getByText('Sub-careers per profile')).toBeVisible();
  await expect(page.locator('.career-summary-card').nth(1).locator('strong')).toHaveText('2');
  await expect(page.getByText('Plan limit reached')).toBeVisible();
  await expect(
    page.getByText(
      'Your plan allows 1 active profile and all of them are in use. Archive or delete a profile before creating another one.',
    ),
  ).toBeVisible();
  // The control that would create a second profile is disabled, not merely
  // styled as unavailable.
  await expect(page.getByRole('button', { name: 'New profile' })).toBeDisabled();

  await page.getByRole('link', { name: 'Open profile' }).first().click();
  const addSubCareer = page.getByRole('button', { name: 'Add sub-career' });

  for (const name of ['Automation', 'Platform']) {
    await addSubCareer.click();
    const dialog = page.getByRole('dialog', { name: 'Add sub-career' });
    await dialog.locator('input[name="name"]').fill(name);
    await dialog.getByRole('button', { name: 'Add sub-career' }).click();
    await expect(page.getByRole('heading', { name, level: 3, exact: true })).toBeVisible();
  }

  // The third is refused by the service, and the refusal is shown verbatim.
  await addSubCareer.click();
  const dialog = page.getByRole('dialog', { name: 'Add sub-career' });
  await dialog.locator('input[name="name"]').fill('Support');
  await dialog.getByRole('button', { name: 'Add sub-career' }).click();
  await expect(dialog.getByText('the current plan allows 2 sub-careers per profile')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Support', level: 3, exact: true })).toHaveCount(
    0,
  );
});

test('adds and edits every career record kind the profile supports', async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page, testAccounts.career);
  await page.goto('/dashboard/career');
  await page.getByRole('link', { name: 'Open profile' }).first().click();

  // A project.
  await page.getByRole('button', { name: 'Add project' }).click();
  let dialog = page.getByRole('dialog', { name: 'Add project' });
  await dialog.locator('input[name="name"]').fill('Intake automation');
  await dialog.locator('input[name="roleTitle"]').fill('Lead engineer');
  await dialog.locator('textarea[name="description"]').fill('Queue-based order intake.');
  await dialog.getByRole('button', { name: 'Add project' }).click();
  await expect(page.getByRole('heading', { name: 'Intake automation', level: 3 })).toBeVisible();

  // Edit it, which is the same editor in its `Save changes` shape.
  const projectCard = page
    .getByRole('heading', { name: 'Intake automation', level: 3 })
    .locator('xpath=ancestor::li[1]');
  await projectCard.getByRole('button', { name: 'Edit' }).click();
  dialog = page.getByRole('dialog', { name: 'Edit project' });
  await dialog.locator('input[name="name"]').fill('Intake automation platform');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(
    page.getByRole('heading', { name: 'Intake automation platform', level: 3 }),
  ).toBeVisible();

  // A certification and an education entry, then edit the education entry.
  await page.getByRole('button', { name: 'Add certification' }).click();
  dialog = page.getByRole('dialog', { name: 'Add certification' });
  await dialog.locator('input[name="name"]').fill('Supabase Fundamentals');
  await dialog.locator('input[name="issuer"]').fill('Supabase');
  await dialog.getByRole('button', { name: 'Add certification' }).click();
  await expect(
    page.getByRole('heading', { name: 'Supabase Fundamentals', level: 3 }),
  ).toBeVisible();

  const educationCard = page
    .getByRole('heading', { name: 'University of the Philippines', level: 3 })
    .locator('xpath=ancestor::li[1]');
  await educationCard.getByRole('button', { name: 'Edit' }).click();
  dialog = page.getByRole('dialog', { name: 'Edit education' });
  await dialog.locator('input[name="fieldOfStudy"]').fill('Information Technology');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('BSc Information Technology · Information Technology')).toBeVisible();

  // Edit the work history entry recorded during onboarding.
  const employmentCard = page
    .getByRole('heading', { name: 'Workflow Automation Engineer · Northstar Systems' })
    .locator('xpath=ancestor::li[1]');
  await employmentCard.getByRole('button', { name: 'Edit' }).click();
  dialog = page.getByRole('dialog', { name: 'Edit employment' });
  await dialog.locator('input[name="location"]').fill('Metro Manila');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(employmentCard.getByText('Metro Manila')).toBeVisible();

  // Edit a skill.
  const skillCard = page
    .getByRole('heading', { name: 'Supabase', level: 3, exact: true })
    .locator('xpath=ancestor::li[1]');
  await skillCard.getByRole('button', { name: 'Edit' }).click();
  dialog = page.getByRole('dialog', { name: 'Edit skill' });
  await dialog.locator('select[name="proficiency"]').selectOption('Advanced');
  await dialog.getByRole('checkbox', { name: 'Mark as a primary skill' }).check();
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(skillCard.getByText('Primary skill')).toBeVisible();

  // Editing the link, then deleting the project record. The record heading is
  // the link's own label, or the humanised kind when it has none.
  const linkCard = page
    .getByRole('heading', { name: 'GitHub', level: 3, exact: true })
    .locator('xpath=ancestor::li[1]');
  await expect(linkCard.getByText('https://github.com/hanaply-e2e')).toBeVisible();
  await linkCard.getByRole('button', { name: 'Edit' }).click();
  dialog = page.getByRole('dialog', { name: 'Edit link' });
  await dialog.locator('input[name="label"]').fill('GitHub profile');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('heading', { name: 'GitHub profile', level: 3 })).toBeVisible();

  await page.getByRole('button', { name: 'Delete Intake automation platform' }).click();
  await expect(
    page.getByRole('heading', { name: 'Intake automation platform', level: 3 }),
  ).toHaveCount(0);
});

test('separates candidate claims from confirmed evidence in the truth ledger', async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page, testAccounts.career);
  await page.goto('/dashboard/career/documents');
  await expect(page.getByRole('heading', { name: 'Documents', level: 1 })).toBeVisible();

  await page.locator('#careerDocumentFile').setInputFiles({
    name: 'career-fixture-resume.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(resumeFixture, 'utf8'),
  });
  await page.locator('#careerDocumentKind').selectOption('Resume');
  await page.locator('#careerDocumentProfile').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Upload document' }).click();
  await expect(
    page.getByText(
      'The document was uploaded and queued for parsing. Extracted items are proposals until you confirm them.',
    ),
  ).toBeVisible();

  // Parsing is deterministic and runs inline, so the draft is ready on reload.
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Proposals from career-fixture-resume.txt' }),
  ).toBeVisible();
  const claims = page.locator('fieldset', { has: page.getByText('Claim proposals') });
  await expect(claims.getByRole('checkbox').first()).toBeVisible();
  const claimCount = await claims.getByRole('checkbox').count();
  expect(claimCount).toBeGreaterThan(0);

  const employment = page.locator('fieldset', { has: page.getByText('Employment proposals') });
  await expect(employment.getByRole('checkbox').first()).toBeVisible();
  await employment.getByRole('checkbox').first().check();
  // Two claims, so one can be confirmed and the other rejected.
  const claimBoxes = claims.getByRole('checkbox', { name: /Claim ·/u });
  expect(await claimBoxes.count()).toBeGreaterThanOrEqual(2);
  await claimBoxes.nth(0).check();
  await claimBoxes.nth(1).check();
  await page.getByRole('checkbox', { name: /I reviewed these proposals/iu }).check();
  await page.getByRole('button', { name: 'Apply selected to profile' }).click();
  await expect(
    page.getByText(/New claims stay in Needs review until you confirm them\./u),
  ).toBeVisible();

  // The ledger is where the distinction has to be visible.
  await page.goto('/dashboard/career');
  await page.getByRole('link', { name: 'Truth ledger' }).first().click();
  await expect(page.getByRole('heading', { name: 'Truth ledger', level: 1 })).toBeVisible();
  await expect(page.getByText('Only confirmed facts may be cited')).toBeVisible();

  const proposals = page.getByRole('region', { name: /\d+ proposals? awaiting your decision/u });
  const confirmed = page.getByRole('region', { name: /\d+ confirmed facts?$/u });
  const rejected = page.getByRole('region', { name: /\d+ rejected claims?$/u });
  await expect(
    proposals
      .getByText('This is a proposal, not a fact. Nothing may cite it until you confirm it.')
      .first(),
  ).toBeVisible();
  await expect(confirmed.getByText(/\b0 confirmed facts\b/u)).toBeVisible();
  await expect(rejected.getByText(/\b0 rejected claims\b/u)).toBeVisible();

  // Confirm one: it becomes citable evidence and leaves the proposal channel.
  const proposalRows = proposals.locator('li');
  const proposalsBefore = await proposalRows.count();
  await proposalRows.first().getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByText('The claim is confirmed and may now be cited.')).toBeVisible();
  // The heading is singular for one, which is also the copy regression this
  // asserts: it read "1 confirmed facts" before.
  await expect(confirmed.getByText(/\b1 confirmed fact$/u)).toBeVisible();
  await expect(proposals.locator('li')).toHaveCount(proposalsBefore - 1);

  // Reject one: it must not become evidence.
  await page.reload();
  const remaining = page.getByRole('region', { name: /\d+ proposals? awaiting your decision/u });
  await remaining
    .locator('li')
    .first()
    .getByRole('button', { name: 'Reject', exact: true })
    .click();
  await expect(page.getByText('The claim was rejected and will not be cited.')).toBeVisible();
  await expect(rejected.getByText(/\b1 rejected claim$/u)).toBeVisible();
  await expect(confirmed.getByText(/\b1 confirmed fact$/u)).toBeVisible();
  await expect(
    rejected.getByText('Rejected claims stay visible so nothing is silently re-added later.'),
  ).toBeVisible();
});

test('takes an unsupported upload and refuses an unsupported file type', async ({ page }) => {
  await signIn(page, testAccounts.career);
  await page.goto('/dashboard/career/documents');
  await page.locator('#careerDocumentFile').setInputFiles({
    name: 'notes.pdf.exe',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('not a resume', 'utf8'),
  });
  await page.getByRole('button', { name: 'Upload document' }).click();
  await expect(page.getByText('Upload a PDF, DOCX, RTF, TXT, or Markdown file.')).toBeVisible();
});
