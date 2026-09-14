import type { CareerProfileDetail, CareerRecordKind } from '@hanaply/contracts';

import {
  employmentTypeOptions,
  linkKindOptions,
  proficiencyOptions,
  skillKindOptions,
  workArrangementOptions,
  type CareerOption,
} from '@/lib/career';

/**
 * One spec per structured career record kind. The spec drives both the editor
 * form and the defaults shown when editing an existing record, so the form and
 * the `careerRecordInputSchema` variants can never drift apart silently.
 */

export interface CareerRecordMap {
  sub_career: NonNullable<CareerProfileDetail['subCareers'][number]>;
  employment: NonNullable<CareerProfileDetail['employment'][number]>;
  project: NonNullable<CareerProfileDetail['projects'][number]>;
  education: NonNullable<CareerProfileDetail['education'][number]>;
  certification: NonNullable<CareerProfileDetail['certifications'][number]>;
  link: NonNullable<CareerProfileDetail['links'][number]>;
  skill: NonNullable<CareerProfileDetail['skills'][number]>;
}

export type CareerRecord = {
  [K in CareerRecordKind]: { kind: K; value: CareerRecordMap[K] };
}[CareerRecordKind];

export type CareerRecordFieldControl =
  'text' | 'textarea' | 'lines' | 'date' | 'number' | 'select' | 'checkbox';

export interface CareerRecordField {
  name: string;
  label: string;
  control: CareerRecordFieldControl;
  required?: boolean;
  hint?: string;
  placeholder?: string;
  maxLength?: number;
  min?: number;
  max?: number;
  step?: number;
  options?: readonly CareerOption[];
  /** Adds an explicit "Not set" choice so an existing value can be cleared. */
  clearable?: boolean;
  /** Renders across the full form width. */
  wide?: boolean;
}

export interface CareerRecordSpec {
  label: string;
  singular: string;
  addLabel: string;
  emptyMessage: string;
  fields: readonly CareerRecordField[];
  values: (record: CareerRecord | null) => Readonly<Record<string, string>>;
  title: (record: CareerRecord) => string;
}

const empty = '';

function dateValue(value: string | null): string {
  return value ? value.slice(0, 10) : empty;
}

function numberValue(value: number | null): string {
  return value === null ? empty : String(value);
}

function listValue(values: readonly string[]): string {
  return values.join('\n');
}

export const careerRecordSpecs: Readonly<Record<CareerRecordKind, CareerRecordSpec>> = {
  sub_career: {
    label: 'Sub-careers',
    singular: 'sub-career',
    addLabel: 'Add sub-career',
    emptyMessage:
      'Sub-careers let one profile search more than one direction, each with its own focus and keywords.',
    fields: [
      { name: 'name', label: 'Name', control: 'text', required: true, maxLength: 120 },
      { name: 'priority', label: 'Priority (0–100)', control: 'number', min: 0, max: 100, step: 1 },
      {
        name: 'focus',
        label: 'Focus',
        control: 'textarea',
        maxLength: 1000,
        wide: true,
        hint: 'What this direction targets, in your own words.',
      },
      {
        name: 'keywords',
        label: 'Keywords',
        control: 'lines',
        wide: true,
        hint: 'One keyword per line. Up to 25.',
      },
    ],
    values: (record) => {
      const value = record?.kind === 'sub_career' ? record.value : null;
      return {
        name: value?.name ?? empty,
        priority: numberValue(value?.priority ?? null),
        focus: value?.focus ?? empty,
        keywords: listValue(value?.keywords ?? []),
      };
    },
    title: (record) => (record.kind === 'sub_career' ? record.value.name : 'Sub-career'),
  },
  employment: {
    label: 'Employment',
    singular: 'employment entry',
    addLabel: 'Add employment',
    emptyMessage:
      'No employment history is recorded yet. Employment is the evidence behind your experience.',
    fields: [
      { name: 'companyName', label: 'Company', control: 'text', required: true, maxLength: 160 },
      { name: 'roleTitle', label: 'Role title', control: 'text', required: true, maxLength: 160 },
      {
        name: 'employmentType',
        label: 'Employment type',
        control: 'select',
        options: employmentTypeOptions,
      },
      {
        name: 'workArrangement',
        label: 'Work arrangement',
        control: 'select',
        options: workArrangementOptions,
        clearable: true,
      },
      { name: 'location', label: 'Location', control: 'text', maxLength: 160 },
      {
        name: 'countryCode',
        label: 'Country code',
        control: 'text',
        maxLength: 2,
        hint: 'Two-letter code, for example PH.',
      },
      {
        name: 'companyUrl',
        label: 'Company website',
        control: 'text',
        maxLength: 500,
        placeholder: 'https://',
      },
      { name: 'industry', label: 'Industry', control: 'text', maxLength: 120 },
      { name: 'startDate', label: 'Start date', control: 'date', required: true },
      {
        name: 'endDate',
        label: 'End date',
        control: 'date',
        hint: 'Leave empty when this is a current role.',
      },
      { name: 'isCurrent', label: 'This is my current role', control: 'checkbox' },
      { name: 'summary', label: 'Summary', control: 'textarea', maxLength: 2000, wide: true },
      {
        name: 'highlights',
        label: 'Highlights',
        control: 'lines',
        wide: true,
        hint: 'One achievement per line. Up to 12.',
      },
      {
        name: 'skills',
        label: 'Skills used',
        control: 'lines',
        wide: true,
        hint: 'One skill per line. Up to 30.',
      },
    ],
    values: (record) => {
      const value = record?.kind === 'employment' ? record.value : null;
      return {
        companyName: value?.companyName ?? empty,
        roleTitle: value?.roleTitle ?? empty,
        employmentType: value?.employmentType ?? 'full_time',
        workArrangement: value?.workArrangement ?? empty,
        location: value?.location ?? empty,
        countryCode: value?.countryCode ?? empty,
        companyUrl: value?.companyUrl ?? empty,
        industry: value?.industry ?? empty,
        startDate: dateValue(value?.startDate ?? null),
        endDate: dateValue(value?.endDate ?? null),
        isCurrent: value?.isCurrent ? 'on' : empty,
        summary: value?.summary ?? empty,
        highlights: listValue(value?.highlights ?? []),
        skills: listValue(value?.skills ?? []),
      };
    },
    title: (record) =>
      record.kind === 'employment'
        ? `${record.value.roleTitle} · ${record.value.companyName}`
        : 'Employment',
  },
  project: {
    label: 'Projects',
    singular: 'project',
    addLabel: 'Add project',
    emptyMessage: 'No projects are recorded yet.',
    fields: [
      { name: 'name', label: 'Project name', control: 'text', required: true, maxLength: 160 },
      { name: 'roleTitle', label: 'Your role', control: 'text', maxLength: 160 },
      {
        name: 'projectUrl',
        label: 'Project link',
        control: 'text',
        maxLength: 500,
        placeholder: 'https://',
      },
      {
        name: 'repositoryUrl',
        label: 'Repository link',
        control: 'text',
        maxLength: 500,
        placeholder: 'https://',
      },
      { name: 'startDate', label: 'Start date', control: 'date' },
      { name: 'endDate', label: 'End date', control: 'date' },
      { name: 'isFeatured', label: 'Feature this project', control: 'checkbox' },
      {
        name: 'description',
        label: 'Description',
        control: 'textarea',
        maxLength: 2000,
        wide: true,
      },
      {
        name: 'highlights',
        label: 'Highlights',
        control: 'lines',
        wide: true,
        hint: 'One achievement per line. Up to 12.',
      },
      {
        name: 'skills',
        label: 'Skills used',
        control: 'lines',
        wide: true,
        hint: 'One skill per line.',
      },
    ],
    values: (record) => {
      const value = record?.kind === 'project' ? record.value : null;
      return {
        name: value?.name ?? empty,
        roleTitle: value?.roleTitle ?? empty,
        projectUrl: value?.projectUrl ?? empty,
        repositoryUrl: value?.repositoryUrl ?? empty,
        startDate: dateValue(value?.startDate ?? null),
        endDate: dateValue(value?.endDate ?? null),
        isFeatured: value?.isFeatured ? 'on' : empty,
        description: value?.description ?? empty,
        highlights: listValue(value?.highlights ?? []),
        skills: listValue(value?.skills ?? []),
      };
    },
    title: (record) => (record.kind === 'project' ? record.value.name : 'Project'),
  },
  education: {
    label: 'Education',
    singular: 'education entry',
    addLabel: 'Add education',
    emptyMessage: 'No education entries are recorded yet.',
    fields: [
      {
        name: 'institution',
        label: 'Institution',
        control: 'text',
        required: true,
        maxLength: 160,
      },
      { name: 'degree', label: 'Degree', control: 'text', maxLength: 160 },
      { name: 'fieldOfStudy', label: 'Field of study', control: 'text', maxLength: 160 },
      { name: 'grade', label: 'Grade or honours', control: 'text', maxLength: 60 },
      { name: 'startYear', label: 'Start year', control: 'number', min: 1930, max: 2100, step: 1 },
      { name: 'endYear', label: 'End year', control: 'number', min: 1930, max: 2100, step: 1 },
      { name: 'isCurrent', label: 'Currently studying here', control: 'checkbox' },
      {
        name: 'description',
        label: 'Description',
        control: 'textarea',
        maxLength: 1000,
        wide: true,
      },
    ],
    values: (record) => {
      const value = record?.kind === 'education' ? record.value : null;
      return {
        institution: value?.institution ?? empty,
        degree: value?.degree ?? empty,
        fieldOfStudy: value?.fieldOfStudy ?? empty,
        grade: value?.grade ?? empty,
        startYear: numberValue(value?.startYear ?? null),
        endYear: numberValue(value?.endYear ?? null),
        isCurrent: value?.isCurrent ? 'on' : empty,
        description: value?.description ?? empty,
      };
    },
    title: (record) => (record.kind === 'education' ? record.value.institution : 'Education'),
  },
  certification: {
    label: 'Certifications',
    singular: 'certification',
    addLabel: 'Add certification',
    emptyMessage: 'No certifications are recorded yet.',
    fields: [
      {
        name: 'name',
        label: 'Certification name',
        control: 'text',
        required: true,
        maxLength: 160,
      },
      { name: 'issuer', label: 'Issuer', control: 'text', maxLength: 160 },
      { name: 'credentialId', label: 'Credential ID', control: 'text', maxLength: 120 },
      {
        name: 'credentialUrl',
        label: 'Credential link',
        control: 'text',
        maxLength: 500,
        placeholder: 'https://',
      },
      { name: 'issuedOn', label: 'Issued on', control: 'date' },
      { name: 'expiresOn', label: 'Expires on', control: 'date' },
    ],
    values: (record) => {
      const value = record?.kind === 'certification' ? record.value : null;
      return {
        name: value?.name ?? empty,
        issuer: value?.issuer ?? empty,
        credentialId: value?.credentialId ?? empty,
        credentialUrl: value?.credentialUrl ?? empty,
        issuedOn: dateValue(value?.issuedOn ?? null),
        expiresOn: dateValue(value?.expiresOn ?? null),
      };
    },
    title: (record) => (record.kind === 'certification' ? record.value.name : 'Certification'),
  },
  link: {
    label: 'Links',
    singular: 'link',
    addLabel: 'Add link',
    emptyMessage:
      'No links are recorded yet. A GitHub or portfolio link counts as citable evidence.',
    fields: [
      {
        name: 'linkKind',
        label: 'Link type',
        control: 'select',
        required: true,
        options: linkKindOptions,
      },
      {
        name: 'url',
        label: 'Web address',
        control: 'text',
        required: true,
        maxLength: 500,
        placeholder: 'https://',
      },
      { name: 'label', label: 'Label', control: 'text', maxLength: 80 },
    ],
    values: (record) => {
      const value = record?.kind === 'link' ? record.value : null;
      return {
        linkKind: value?.linkKind ?? 'github',
        url: value?.url ?? empty,
        label: value?.label ?? empty,
      };
    },
    title: (record) =>
      record.kind === 'link'
        ? (record.value.label ?? record.value.linkKind.replaceAll('_', ' '))
        : 'Link',
  },
  skill: {
    label: 'Skills',
    singular: 'skill',
    addLabel: 'Add skill',
    emptyMessage:
      'No skills are recorded yet. Five or more skills complete this part of the profile.',
    fields: [
      { name: 'name', label: 'Skill', control: 'text', required: true, maxLength: 100 },
      { name: 'skillKind', label: 'Kind', control: 'select', options: skillKindOptions },
      {
        name: 'proficiency',
        label: 'Proficiency',
        control: 'select',
        options: proficiencyOptions,
        clearable: true,
      },
      {
        name: 'yearsExperience',
        label: 'Years using it',
        control: 'number',
        min: 0,
        max: 80,
        step: 0.5,
      },
      {
        name: 'lastUsedYear',
        label: 'Last used (year)',
        control: 'number',
        min: 1930,
        max: 2100,
        step: 1,
      },
      { name: 'isPrimary', label: 'Mark as a primary skill', control: 'checkbox' },
    ],
    values: (record) => {
      const value = record?.kind === 'skill' ? record.value : null;
      return {
        name: value?.name ?? empty,
        skillKind: value?.skillKind ?? 'skill',
        proficiency: value?.proficiency ?? empty,
        yearsExperience: numberValue(value?.yearsExperience ?? null),
        lastUsedYear: numberValue(value?.lastUsedYear ?? null),
        isPrimary: value?.isPrimary ? 'on' : empty,
      };
    },
    title: (record) => (record.kind === 'skill' ? record.value.name : 'Skill'),
  },
};
