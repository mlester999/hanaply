import {
  expect,
  test as base,
  type ConsoleMessage,
  type Page,
  type Request,
  type Response,
} from '@playwright/test';

export type { Page };

interface ResponseMatcher {
  /** Substring or pattern the request URL must contain. */
  url: string | RegExp;
  /** Required status. Omit to accept any 4xx/5xx. */
  status?: number;
  /** Required method. Omit to accept any method. */
  method?: string;
  /** Why this failure is expected — required so the allowlist stays honest. */
  reason: string;
}

export interface BrowserHealth {
  /**
   * Declares one expected, non-2xx response. Anything not declared here fails
   * the test, so every tolerated failure carries a written reason.
   */
  expectFailure(matcher: ResponseMatcher): void;
  /** Declares one expected console error (for example a deliberately rejected form). */
  allowConsoleError(text: string | RegExp, reason: string): void;
}

interface FailedResponse {
  method: string;
  status: number;
  url: string;
}

interface ConsoleEntry {
  text: string;
}

const hydrationPatterns = [/hydration/iu, /did not match/iu, /server rendered HTML/iu];

function matches(matcher: ResponseMatcher, failure: FailedResponse): boolean {
  const urlMatches =
    typeof matcher.url === 'string'
      ? failure.url.includes(matcher.url)
      : matcher.url.test(failure.url);
  if (!urlMatches) return false;
  if (matcher.status !== undefined && matcher.status !== failure.status) return false;
  if (matcher.method !== undefined && matcher.method !== failure.method) return false;
  return true;
}

function describeFailure(failure: FailedResponse): string {
  return `${failure.method} ${failure.url} → HTTP ${failure.status}`;
}

/**
 * Console and network health for every browser spec.
 *
 * A browser suite that only asserts on the DOM silently accepts broken pages:
 * hydration mismatches, uncaught exceptions, and failed requests all leave the
 * assertions green. This fixture is registered automatically for every test that
 * uses the exported `test`, records console errors, uncaught page errors,
 * hydration errors, and every 4xx/5xx response or failed request, and fails the
 * test with the collected detail. Expected failures must be declared through
 * `browserHealth.expectFailure`, which requires a reason.
 */
export const test = base.extend<{ browserHealth: BrowserHealth }>({
  browserHealth: [
    async ({ page }, use) => {
      const expectedResponses: ResponseMatcher[] = [];
      const expectedConsole: { pattern: string | RegExp; reason: string }[] = [];
      const consoleErrors: ConsoleEntry[] = [];
      const pageErrors: string[] = [];
      const failedResponses: FailedResponse[] = [];
      const failedRequests: string[] = [];

      const onConsole = (message: ConsoleMessage) => {
        if (message.type() === 'error') consoleErrors.push({ text: message.text() });
      };
      const onPageError = (error: Error) => {
        pageErrors.push(`${error.message}\n${error.stack ?? ''}`.trim());
      };
      const onResponse = (response: Response) => {
        const status = response.status();
        if (status < 400) return;
        failedResponses.push({
          status,
          url: response.url(),
          method: response.request().method(),
        });
      };
      const onRequestFailed = (request: Request) => {
        const failure = request.failure();
        // A cancelled navigation or a superseded RSC fetch is not an application
        // defect; every other transport failure is.
        if (!failure || failure.errorText.includes('ERR_ABORTED')) return;
        failedRequests.push(`${request.url()} → ${failure.errorText}`);
      };

      page.on('console', onConsole);
      page.on('pageerror', onPageError);
      page.on('response', onResponse);
      page.on('requestfailed', onRequestFailed);

      await use({
        expectFailure: (matcher) => {
          expectedResponses.push(matcher);
        },
        allowConsoleError: (text, reason) => {
          expectedConsole.push({ pattern: text, reason });
        },
      });

      page.off('console', onConsole);
      page.off('pageerror', onPageError);
      page.off('response', onResponse);
      page.off('requestfailed', onRequestFailed);

      const unexpectedResponses = failedResponses.filter(
        (failure) => !expectedResponses.some((matcher) => matches(matcher, failure)),
      );
      const unexpectedConsole = consoleErrors.filter(
        (entry) =>
          !expectedConsole.some(({ pattern }) =>
            typeof pattern === 'string' ? entry.text.includes(pattern) : pattern.test(entry.text),
          ),
      );
      const hydrationErrors = unexpectedConsole.filter((entry) =>
        hydrationPatterns.some((pattern) => pattern.test(entry.text)),
      );

      expect(
        hydrationErrors.map((entry) => entry.text),
        'the browser reported a hydration error',
      ).toEqual([]);
      expect(pageErrors, 'the page threw an uncaught exception').toEqual([]);
      expect(
        unexpectedConsole.map((entry) => entry.text),
        'the browser logged an unexpected console error',
      ).toEqual([]);
      expect(
        unexpectedResponses.map(describeFailure),
        'the browser saw an unexpected failed request',
      ).toEqual([]);
      expect(failedRequests, 'the browser saw an unexpected transport failure').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
