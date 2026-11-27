/**
 * The conversions a web app most likely has, found by a static scan of its
 * routes and source: sign up, checkout, book a demo, contact.
 *
 * The scan proposes; the web-analytics task confirms with the user before
 * anything is created in PostHog. So it favors recall over precision, ranks
 * by evidence, and leaves the final call to a person.
 */
import path from 'path';
import { readProjectFile, walkProjectFiles } from '@utils/bounded-fs';

export type ConversionKind = 'signup' | 'checkout' | 'demo' | 'contact';

export type ConversionCandidate = {
  kind: ConversionKind;
  label: string;
  /** Files that carry the evidence, relative to the project, strongest first. */
  files: string[];
  /** The page's URL path, when a route file names it. */
  route?: string;
  /** An event the project already captures with PostHog for this conversion. */
  posthogEvent?: string;
  /** What the scan found, one short phrase each, for the person and the agent. */
  signals: string[];
  score: number;
};

export type ConversionScan = {
  candidates: ConversionCandidate[];
  /** Routes that read as a post-conversion page, such as `/thank-you`. */
  successRoutes: string[];
};

const LABELS: Record<ConversionKind, string> = {
  signup: 'Sign up',
  checkout: 'Checkout or purchase',
  demo: 'Book a demo',
  contact: 'Contact form',
};

/** Tie-break order: the conversion most products count first. */
const KIND_ORDER: readonly ConversionKind[] = [
  'signup',
  'checkout',
  'demo',
  'contact',
];

const ROUTE_WORDS: Record<ConversionKind, RegExp> = {
  signup: /^(sign-?up|register|registration|create-account|join|get-started)$/i,
  checkout: /^(checkout|purchase|buy|subscribe|payment)$/i,
  demo: /^(demo|book-a-demo|book-demo|request-demo|schedule-demo|talk-to-sales)$/i,
  contact: /^(contact|contact-us|contact-sales|get-in-touch|enquiry|inquiry)$/i,
};

const SUCCESS_WORDS =
  /^(thank-?you|thanks|success|welcome|confirmation|order-confirmed)$/i;

/** Calls another analytics tool makes when this conversion happens. */
const ANALYTICS_CALLS: Record<ConversionKind, RegExp> = {
  signup:
    /gtag\(\s*['"]event['"]\s*,\s*['"]sign_up['"]|fbq\(\s*['"]track['"]\s*,\s*['"]CompleteRegistration['"]|\.track\(\s*['"](signed up|sign up|user signed up)['"]/i,
  checkout:
    /gtag\(\s*['"]event['"]\s*,\s*['"](purchase|begin_checkout)['"]|fbq\(\s*['"]track['"]\s*,\s*['"](Purchase|InitiateCheckout)['"]|redirectToCheckout|checkout\.sessions\.create/i,
  demo: /calendly\.com|cal\.com\/|fbq\(\s*['"]track['"]\s*,\s*['"]Schedule['"]|\.track\(\s*['"](demo requested|book(ed)? a demo)['"]/i,
  contact:
    /gtag\(\s*['"]event['"]\s*,\s*['"]generate_lead['"]|fbq\(\s*['"]track['"]\s*,\s*['"](Lead|Contact)['"]/i,
};

/** A word in an identifier or event name that ties code to a conversion kind. */
const NAME_WORDS: Record<ConversionKind, RegExp> = {
  signup: /sign_?up|signed_?up|register|create_?account/i,
  checkout:
    /checkout|purchase|order_?(placed|completed)|subscri(be|ption)_?(started|created)/i,
  demo: /demo/i,
  contact: /contact|lead|enquir|inquir/i,
};

const FORM =
  /<form[\s>]|onSubmit=|handleSubmit|useForm\(|action=\{|method=["']post["']/i;
const POSTHOG_CAPTURE = /posthog\??\.capture\(\s*['"`]([^'"`]+)['"`]/g;
/** A route a router declares in code, such as `<Route path="/signup">` or `{ path: '/signup' }`. */
const DECLARED_ROUTE = /\bpath\s*[=:]\s*\{?\s*['"`](\/[^'"`]*)['"`]/g;

const SOURCE_FILE = /\.(tsx?|jsx?|mjs|vue|svelte|astro|html|erb|php|py)$/i;
const TEST_FILE =
  /(\.test\.|\.spec\.|\.stories\.|__tests__|__mocks__|\/e2e\/|\/tests?\/)/i;

/** Route roots whose subfolders and files are URL paths. */
const ROUTE_ROOTS = new Set(['app', 'pages', 'routes', 'views', 'templates']);

/** File names that stand for their folder's route. */
const INDEX_NAMES = /^(page|index|\+page|route|\+page\.server|layout)$/i;

const MAX_DEPTH = 8;
const MAX_FILES_READ = 3_000;
const MAX_FILES_PER_CANDIDATE = 3;
const MAX_CANDIDATES = 4;

type Evidence = {
  file: string;
  route?: string;
  posthogEvent?: string;
  signals: string[];
  score: number;
};

/** The URL path a route file serves, or undefined when the file is not under a route root. */
export function routeForFile(relativePath: string): string | undefined {
  const parts = relativePath.split(path.sep).join('/').split('/');
  const rootIndex = parts.findIndex((part) => ROUTE_ROOTS.has(part));
  if (rootIndex === -1) return undefined;

  const segments = parts.slice(rootIndex + 1);
  const last = segments.pop();
  if (last === undefined) return undefined;
  const base = last.replace(/\.[^.]+$/, '').replace(/\.[^.]+$/, '');
  if (!INDEX_NAMES.test(base)) segments.push(base);

  const urlSegments = segments
    // Next.js route groups and private folders don't reach the URL.
    .filter((s) => !/^\(.*\)$/.test(s) && !s.startsWith('_'))
    .map((s) => s.replace(/^\$/, ':'));
  return '/' + urlSegments.join('/');
}

function routeKind(route: string): ConversionKind | undefined {
  const segments = route.split('/').filter(Boolean);
  return KIND_ORDER.find((kind) =>
    segments.some((segment) => ROUTE_WORDS[kind].test(segment)),
  );
}

function isSuccessRoute(route: string): boolean {
  return route
    .split('/')
    .filter(Boolean)
    .some((segment) => SUCCESS_WORDS.test(segment));
}

function evidenceFor(
  kind: ConversionKind,
  file: string,
  route: string | undefined,
  content: string,
): Evidence | undefined {
  const signals: string[] = [];
  let score = 0;

  const declared = [...content.matchAll(DECLARED_ROUTE)]
    .map((match) => match[1])
    .find((declaredRoute) => routeKind(declaredRoute) === kind);
  const fileRoute =
    route !== undefined && routeKind(route) === kind ? route : undefined;
  const matchedRoute = fileRoute ?? declared;
  if (matchedRoute) {
    signals.push(`route ${matchedRoute}`);
    score += 3;
  }

  if (ANALYTICS_CALLS[kind].test(content)) {
    signals.push('existing conversion tracking');
    score += 3;
  }

  let posthogEvent: string | undefined;
  for (const match of content.matchAll(POSTHOG_CAPTURE)) {
    if (NAME_WORDS[kind].test(match[1])) {
      posthogEvent = match[1];
      signals.push(`captures "${match[1]}"`);
      score += 4;
      break;
    }
  }

  // A form only counts where something else already ties the file to the kind.
  if (score > 0 && FORM.test(content)) {
    signals.push('form');
    score += 2;
  }

  if (score === 0) return undefined;
  return { file, route: matchedRoute, posthogEvent, signals, score };
}

function mergeEvidence(
  kind: ConversionKind,
  evidence: Evidence[],
): ConversionCandidate {
  const sorted = [...evidence].sort(
    (a, b) => b.score - a.score || a.file.localeCompare(b.file),
  );
  const top = sorted.slice(0, MAX_FILES_PER_CANDIDATE);
  return {
    kind,
    label: LABELS[kind],
    files: top.map((e) => e.file),
    route: sorted.find((e) => e.route)?.route,
    posthogEvent: sorted.find((e) => e.posthogEvent)?.posthogEvent,
    signals: [...new Set(top.flatMap((e) => e.signals))],
    // The best file carries the candidate; each further file adds a little.
    score: sorted[0].score + (sorted.length - 1),
  };
}

/** Scan a project for its likely conversions, best first. Best-effort and bounded. */
export function scanConversionCandidates(installDir: string): ConversionScan {
  const byKind = new Map<ConversionKind, Evidence[]>();
  const successRoutes = new Set<string>();
  let filesRead = 0;

  walkProjectFiles(
    installDir,
    (name, fullPath) => {
      if (filesRead >= MAX_FILES_READ) return;
      if (!SOURCE_FILE.test(name)) return;
      const file = path.relative(installDir, fullPath);
      if (TEST_FILE.test(`/${file.split(path.sep).join('/')}`)) return;

      const route = routeForFile(file);
      if (route !== undefined && isSuccessRoute(route))
        successRoutes.add(route);

      const content = readProjectFile(fullPath);
      filesRead += 1;
      if (content === null) return;

      for (const kind of KIND_ORDER) {
        const evidence = evidenceFor(kind, file, route, content);
        if (evidence) byKind.set(kind, [...(byKind.get(kind) ?? []), evidence]);
      }
    },
    MAX_DEPTH,
    { followSymlinks: false },
  );

  const candidates = [...byKind.entries()]
    .map(([kind, evidence]) => mergeEvidence(kind, evidence))
    .sort(
      (a, b) =>
        b.score - a.score ||
        KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind),
    )
    .slice(0, MAX_CANDIDATES);

  return { candidates, successRoutes: [...successRoutes].sort() };
}

/** One line per candidate, for the task input and the facts every task reads. */
export function describeCandidate(candidate: ConversionCandidate): string {
  return `${candidate.label} (${candidate.signals.join(
    ', ',
  )}; ${candidate.files.join(', ')})`;
}
