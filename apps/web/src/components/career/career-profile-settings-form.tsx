'use client';

import type { CareerProfileDetail } from '@hanaply/contracts';
import { Button, Card, FormField, Input } from '@hanaply/ui';
import { Save } from 'lucide-react';

import { updateCareerProfileAction } from '@/app/(customer)/dashboard/career/actions';
import { CareerFeedback, CareerFieldError } from '@/components/career/career-feedback';
import { ChipListField } from '@/components/career/chip-list-field';
import { SummaryField } from '@/components/career/summary-field';
import { useCareerAction } from '@/components/career/use-career-action';
import {
  availabilityOptions,
  careerLevelOptions,
  currencyOptions,
  employmentTypeOptions,
  minorToInputValue,
  salaryPeriodOptions,
  workArrangementOptions,
} from '@/lib/career';

/** Every scalar field the API allows the owner to change, plus the version. */
export function CareerProfileSettingsForm({ profile }: { profile: CareerProfileDetail }) {
  const { state, onSubmit, pending } = useCareerAction(updateCareerProfileAction);
  const salary = profile.salaryExpectation;
  // The currency column is a three-letter code, so a stored code that is not in
  // the suggestion list is offered as-is rather than silently replaced.
  const storedCurrency = salary?.currency ?? null;
  const currencyChoices =
    storedCurrency && !currencyOptions.some((option) => option.value === storedCurrency)
      ? [{ value: storedCurrency, label: storedCurrency }, ...currencyOptions]
      : currencyOptions;

  return (
    <Card className="career-section-card">
      <form className="career-form" onSubmit={onSubmit}>
        <div className="career-section-heading">
          <div>
            <span className="h-eyebrow">Profile settings</span>
            <h2>Profile details</h2>
            <p>
              Saved under optimistic concurrency: if this profile changed in another tab, the save
              is refused and you are told to reload.
            </p>
          </div>
        </div>

        <input name="profileId" type="hidden" value={profile.id} />
        <input name="expectedVersion" type="hidden" value={profile.version} />

        <div className="career-form-grid">
          <FormField id="careerProfileName" label="Profile name" required>
            <Input
              defaultValue={profile.name}
              id="careerProfileName"
              maxLength={120}
              name="name"
              required
            />
          </FormField>
          <FormField
            hint="Shown as the first line of a match summary."
            id="careerProfileHeadline"
            label="Headline"
          >
            <Input
              defaultValue={profile.headline ?? ''}
              id="careerProfileHeadline"
              maxLength={160}
              name="headline"
            />
          </FormField>
          <FormField id="careerProfileCurrentRole" label="Current role title">
            <Input
              defaultValue={profile.currentRoleTitle ?? ''}
              id="careerProfileCurrentRole"
              maxLength={160}
              name="currentRoleTitle"
            />
          </FormField>
          <FormField id="careerProfileLevel" label="Career level">
            <select
              className="h-input"
              defaultValue={profile.careerLevel ?? ''}
              id="careerProfileLevel"
              name="careerLevel"
            >
              <option value="">Not set</option>
              {careerLevelOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField
            hint="Between 0 and 80. Fractions are allowed."
            id="careerProfileYears"
            label="Years of experience"
          >
            <Input
              defaultValue={profile.yearsExperience === null ? '' : String(profile.yearsExperience)}
              id="careerProfileYears"
              max={80}
              min={0}
              name="yearsExperience"
              step={0.5}
              type="number"
            />
          </FormField>
          <FormField id="careerProfileAvailability" label="Availability">
            <select
              className="h-input"
              defaultValue={profile.availability ?? ''}
              id="careerProfileAvailability"
              name="availability"
            >
              <option value="">Not set</option>
              {availabilityOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </FormField>
        </div>

        <SummaryField
          defaultValue={profile.summary ?? ''}
          hint="Anything a recruiter should know that the structured fields cannot carry."
          id="careerProfileSummary"
          label="Professional summary"
          name="summary"
        />

        <div className="career-form-grid">
          <ChipListField
            emptyMessage="No target roles yet. Matching needs at least one."
            id="careerProfileTargetRoles"
            initialValues={profile.targetRoleTitles}
            label="Target role titles"
            maxItems={15}
            maxLength={120}
            name="targetRoleTitles"
            placeholder="Example: Backend Engineer"
          />
          <ChipListField
            emptyMessage="No excluded roles yet."
            hint="Roles that should never be matched. Up to 15."
            id="careerProfileExcludedRoles"
            initialValues={profile.excludedRoleTitles}
            label="Roles you do not want"
            maxItems={15}
            maxLength={120}
            name="excludedRoleTitles"
            placeholder="Example: Sales Manager"
          />
          <ChipListField
            emptyMessage="No industries yet."
            id="careerProfileIndustries"
            initialValues={profile.industries}
            label="Industries"
            maxItems={20}
            maxLength={80}
            name="industries"
            placeholder="Example: Financial technology"
          />
          <ChipListField
            emptyMessage="No preferred locations yet."
            hint="Up to 20 locations. A remote preference does not need one."
            id="careerProfileLocations"
            initialValues={profile.preferredLocations}
            label="Preferred locations"
            maxItems={20}
            maxLength={120}
            name="preferredLocations"
            placeholder="Example: Cebu City"
          />
          <ChipListField
            emptyMessage="No work authorisations recorded."
            hint="Up to 15 entries, for example a visa or citizenship."
            id="careerProfileAuthorizations"
            initialValues={profile.workAuthorizations}
            label="Work authorisations"
            maxItems={15}
            maxLength={120}
            name="workAuthorizations"
            placeholder="Example: Philippines citizen"
          />
        </div>

        <fieldset className="career-choice-group">
          <legend className="h-label">Preferred employment types</legend>
          <div className="career-choice-options">
            {employmentTypeOptions.map((option) => (
              <label className="career-choice" key={option.value}>
                <input
                  defaultChecked={profile.preferredEmploymentTypes.includes(option.value)}
                  name="preferredEmploymentTypes"
                  type="checkbox"
                  value={option.value}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="career-choice-group">
          <legend className="h-label">Preferred work arrangement</legend>
          <div className="career-choice-options">
            {workArrangementOptions.map((option) => (
              <label className="career-choice" key={option.value}>
                <input
                  defaultChecked={profile.preferredWorkArrangement === option.value}
                  name="preferredWorkArrangement"
                  type="radio"
                  value={option.value}
                />
                <span>{option.label}</span>
              </label>
            ))}
            <label className="career-choice">
              <input
                defaultChecked={profile.preferredWorkArrangement === null}
                name="preferredWorkArrangement"
                type="radio"
                value=""
              />
              <span>No preference recorded</span>
            </label>
          </div>
        </fieldset>

        <div className="career-choice-options">
          <label className="career-choice">
            <input
              defaultChecked={profile.openToInternational}
              name="openToInternational"
              type="checkbox"
            />
            <span>Open to international roles</span>
          </label>
          <label className="career-choice">
            <input
              defaultChecked={profile.openToRelocation}
              name="openToRelocation"
              type="checkbox"
            />
            <span>Open to relocation</span>
          </label>
        </div>

        <fieldset className="career-choice-group">
          <legend className="h-label">Salary expectation</legend>
          <div className="career-form-grid">
            <FormField hint="Amount, not minor units." id="careerSalaryMin" label="Minimum">
              <Input
                defaultValue={minorToInputValue(salary?.minMinor ?? null)}
                id="careerSalaryMin"
                inputMode="decimal"
                min={1}
                name="salaryMin"
                type="number"
              />
            </FormField>
            <FormField id="careerSalaryMax" label="Maximum">
              <Input
                defaultValue={minorToInputValue(salary?.maxMinor ?? null)}
                id="careerSalaryMax"
                inputMode="decimal"
                min={1}
                name="salaryMax"
                type="number"
              />
            </FormField>
            <FormField id="careerSalaryCurrency" label="Currency">
              <select
                className="h-input"
                defaultValue={salary?.currency ?? 'PHP'}
                id="careerSalaryCurrency"
                name="salaryCurrency"
              >
                {currencyChoices.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField
              hint="A pay period needs a minimum amount."
              id="careerSalaryPeriod"
              label="Pay period"
            >
              <select
                className="h-input"
                defaultValue={salary?.period ?? ''}
                id="careerSalaryPeriod"
                name="salaryPeriod"
              >
                <option value="">Not set</option>
                {salaryPeriodOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </FormField>
          </div>
          <CareerFieldError field="salaryMinMinor" id="careerSalaryMin-error" state={state} />
          <CareerFieldError field="salaryPeriod" id="careerSalaryPeriod-error" state={state} />
        </fieldset>

        <FormField
          hint="What you want the next role to move you toward."
          id="careerProfileGoals"
          label="Career goals"
        >
          <textarea
            className="h-input h-textarea"
            defaultValue={profile.careerGoals ?? ''}
            id="careerProfileGoals"
            maxLength={2000}
            name="careerGoals"
            rows={4}
          />
        </FormField>

        <CareerFeedback errorTitle="Profile not saved" state={state} successTitle="Profile saved" />

        <div className="career-form-actions">
          <Button
            leadingIcon={<Save aria-hidden="true" size={18} />}
            loading={pending}
            type="submit"
          >
            Save Profile
          </Button>
        </div>
      </form>
    </Card>
  );
}
