'use client';

import type { JobRadarQuery } from '@hanaply/contracts';
import { Badge, Button, Card } from '@hanaply/ui';
import { Filter, RotateCcw, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type SubmitEvent } from 'react';

import {
  radarActiveFilters,
  radarEmploymentTypeOptions,
  radarMinimumScoreOptions,
  radarPostedWithinOptions,
  radarRemoteStateOptions,
  radarSeniorityOptions,
  radarSortOptions,
  radarVerdictOptions,
} from '@/lib/radar';

export interface RadarProfileOption {
  value: string;
  label: string;
}

export interface RadarFilterBarProps {
  query: JobRadarQuery;
  basePath: string;
  profileOptions: readonly RadarProfileOption[];
  /** The scope this page is pinned to, so "clear" never silently rescopes it. */
  pinnedSaved?: boolean;
  pinnedDismissed?: boolean;
}

function CheckboxGroup({
  name,
  legend,
  options,
  selected,
  idPrefix,
}: {
  name: string;
  legend: string;
  options: readonly { value: string; label: string }[];
  selected: readonly string[];
  idPrefix: string;
}) {
  return (
    <fieldset className="radar-filter-group">
      <legend>{legend}</legend>
      <div className="radar-filter-options">
        {options.map((option) => (
          <label className="radar-check" htmlFor={`${idPrefix}-${option.value}`} key={option.value}>
            <input
              defaultChecked={selected.includes(option.value)}
              id={`${idPrefix}-${option.value}`}
              name={name}
              type="checkbox"
              value={option.value}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * The filter bar is a GET form, so every filter is a real URL and a filtered
 * radar can be bookmarked or shared. The submission is intercepted only to
 * keep the previous results on screen while the next page loads: nothing about
 * the form itself is stateful, and it still submits as a plain GET form
 * without scripting.
 */
export function RadarFilterBar({
  query,
  basePath,
  profileOptions,
  pinnedSaved = false,
  pinnedDismissed = false,
}: RadarFilterBarProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [formKey, setFormKey] = useState(0);
  const activeFilters = radarActiveFilters(query, {
    excludeStatus: pinnedSaved || pinnedDismissed,
  });

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(event.currentTarget).entries()) {
      if (typeof value === 'string' && value !== '') params.append(key, value);
    }
    const queryString = params.toString();
    startTransition(() => {
      router.push(queryString === '' ? basePath : `${basePath}?${queryString}`);
    });
  }

  /**
   * Clearing bumps the form key, which discards every typed and checked value,
   * then navigates to the unfiltered path. The scope checkboxes are not part of
   * the key, so the member can still narrow from a clean form.
   */
  function clearAll() {
    setFormKey((current) => current + 1);
    startTransition(() => {
      router.replace(basePath);
    });
  }

  return (
    <Card className="radar-filter-card">
      <div className="radar-filter-heading">
        <h2 id="radar-filter-title">
          <Filter aria-hidden="true" size={18} /> Filter opportunities
        </h2>
        <Badge tone={activeFilters.length > 0 ? 'brand' : 'neutral'}>
          {activeFilters.length === 0
            ? 'No filters active'
            : `${activeFilters.length} ${activeFilters.length === 1 ? 'filter' : 'filters'} active`}
        </Badge>
      </div>

      {activeFilters.length > 0 ? (
        <div className="radar-filter-applied">
          <ul aria-label="Filters currently applied" className="radar-active-filters">
            {activeFilters.map((filter) => (
              <li key={`${filter.label}:${filter.value}`}>
                <strong>{filter.label}</strong>
                <span>{filter.value}</span>
              </li>
            ))}
          </ul>
          <button className="radar-clear-link" onClick={clearAll} type="button">
            <RotateCcw aria-hidden="true" size={14} /> Clear all filters
          </button>
        </div>
      ) : (
        <p className="career-hint">
          No filters are applied, so this is every active opportunity the radar can see. Add a
          filter below to narrow it; the results you are reading stay on screen while the next set
          loads.
        </p>
      )}

      <form
        aria-labelledby="radar-filter-title"
        className="radar-filter-form"
        key={formKey}
        method="get"
        onSubmit={submit}
      >
        {/*
          Empty values are dropped before the URL is built, so these act as
          "no scope selected" defaults. A checkbox with the same name wins over
          them once it is checked, and a pinned page keeps its scope in place.
        */}
        <input name="savedOnly" type="hidden" value={pinnedSaved ? 'on' : ''} />
        <input name="dismissedOnly" type="hidden" value={pinnedDismissed ? 'on' : ''} />

        <div className="radar-filter-grid">
          <div className="radar-filter-field radar-filter-field--search">
            <label className="h-label" htmlFor="radar-search">
              Search
            </label>
            <div className="radar-search-input">
              <Search aria-hidden="true" size={16} />
              <input
                className="h-input"
                defaultValue={query.search ?? ''}
                id="radar-search"
                maxLength={120}
                name="search"
                placeholder="Job title, company, or skill"
                type="search"
              />
            </div>
          </div>

          <div className="radar-filter-field">
            <label className="h-label" htmlFor="radar-profile">
              Career profile
            </label>
            <select
              className="h-input"
              defaultValue={query.careerProfileId ?? ''}
              id="radar-profile"
              name="careerProfileId"
            >
              <option value="">Automatic — your primary profile</option>
              {profileOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="radar-filter-field">
            <label className="h-label" htmlFor="radar-sort">
              Sort
            </label>
            <select className="h-input" defaultValue={query.sort} id="radar-sort" name="sort">
              {radarSortOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="radar-filter-field">
            <label className="h-label" htmlFor="radar-min-score">
              Minimum match score
            </label>
            <select
              className="h-input"
              defaultValue={query.minScore === undefined ? '' : String(query.minScore)}
              id="radar-min-score"
              name="minScore"
            >
              <option value="">Any score, including not analysed</option>
              {radarMinimumScoreOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="radar-filter-hint">
              A minimum score hides opportunities that have not been analysed yet, because they have
              no score to compare.
            </p>
          </div>

          <div className="radar-filter-field">
            <label className="h-label" htmlFor="radar-posted">
              Posted within
            </label>
            <select
              className="h-input"
              defaultValue={
                query.postedWithinDays === undefined ? '' : String(query.postedWithinDays)
              }
              id="radar-posted"
              name="postedWithinDays"
            >
              <option value="">Any posting date</option>
              {radarPostedWithinOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <fieldset className="radar-filter-group radar-filter-group--inline">
            <legend>Location</legend>
            <div className="radar-filter-options">
              <label className="radar-check" htmlFor="radar-philippines">
                <input
                  defaultChecked={query.philippinesOnly === true}
                  id="radar-philippines"
                  name="philippinesOnly"
                  type="checkbox"
                  value="1"
                />
                <span>Philippines only</span>
              </label>
              <label className="radar-check" htmlFor="radar-international">
                <input
                  defaultChecked={query.internationalOnly === true}
                  id="radar-international"
                  name="internationalOnly"
                  type="checkbox"
                  value="1"
                />
                <span>International</span>
              </label>
            </div>
          </fieldset>

          <fieldset className="radar-filter-group radar-filter-group--inline">
            <legend>Saved or dismissed</legend>
            <div className="radar-filter-options">
              <label className="radar-check" htmlFor="radar-saved-only">
                <input
                  defaultChecked={query.savedOnly === true}
                  disabled={pinnedSaved}
                  id="radar-saved-only"
                  name="savedOnly"
                  type="checkbox"
                  value="on"
                />
                <span>Saved only</span>
              </label>
              <label className="radar-check" htmlFor="radar-dismissed-only">
                <input
                  defaultChecked={query.dismissedOnly === true}
                  disabled={pinnedDismissed}
                  id="radar-dismissed-only"
                  name="dismissedOnly"
                  type="checkbox"
                  value="on"
                />
                <span>Dismissed only</span>
              </label>
            </div>
            <p className="radar-filter-hint">
              Dismissed shows the opportunities you gave a negative signal; the default radar hides
              them.
              {pinnedSaved || pinnedDismissed
                ? ' This view is pinned to its own list, so that box is fixed here — choose the other list, or clear the filters, to change it.'
                : ''}
            </p>
          </fieldset>
        </div>

        <div className="radar-filter-groups">
          <CheckboxGroup
            idPrefix="radar-remote"
            legend="Work setup"
            name="remoteStates"
            options={radarRemoteStateOptions}
            selected={query.remoteStates ?? []}
          />
          <CheckboxGroup
            idPrefix="radar-employment"
            legend="Employment type"
            name="employmentTypes"
            options={radarEmploymentTypeOptions}
            selected={query.employmentTypes ?? []}
          />
          <CheckboxGroup
            idPrefix="radar-seniority"
            legend="Seniority"
            name="seniorities"
            options={radarSeniorityOptions}
            selected={query.seniorities ?? []}
          />
          <CheckboxGroup
            idPrefix="radar-verdict"
            legend="Verdict"
            name="verdicts"
            options={radarVerdictOptions}
            selected={query.verdicts ?? []}
          />
        </div>

        <div className="radar-filter-actions">
          <Button
            leadingIcon={<Filter aria-hidden="true" size={16} />}
            loading={pending}
            type="submit"
          >
            Apply filters
          </Button>
          <button className="radar-clear-link" onClick={clearAll} type="button">
            Clear all filters
          </button>
          <p aria-live="polite" className="radar-filter-status" role="status">
            {pending ? 'Updating results…' : ''}
          </p>
        </div>
      </form>
    </Card>
  );
}
