/**
 * The agent-in-the-loop half of the e2e profile: how a run answers a
 * `wizard_ask` batch, and how it resolves a task notice.
 *
 * These two decision points are the only places a headless run stands in for a
 * person. Everything below pins the resolution order the cross-repo contract
 * froze, so a workbench run can rely on it.
 */

import { Overlay, ScreenId } from '@ui/tui/router';
import type { AskQuestion } from '@lib/wizard-session';
import {
  DEFAULT_E2E_PROFILE,
  E2E_ANSWER_SENTINEL,
  E2E_DRIVABLE_SCREENS,
  answerQuestions,
  decideE2eAction,
  type WizardE2eProfile,
} from '../e2e-profile';
import { profileFor, resolveE2eProfile } from '../profiles';
import { Program } from '@lib/programs/program-registry';
import type { CiState } from '../wizard-ci-driver';

const text = (id: string, prompt = id): AskQuestion => ({
  id,
  prompt,
  kind: 'text',
});

/** Free text the skill flagged sensitive — the only shape a secret rule answers. */
const sensitiveText = (id: string, prompt = id): AskQuestion => ({
  ...text(id, prompt),
  sensitive: true,
});

const single = (id: string, values: string[]): AskQuestion => ({
  id,
  prompt: id,
  kind: 'single',
  options: values.map((v) => ({ label: v, value: v })),
});

const multi = (id: string, values: string[]): AskQuestion => ({
  ...single(id, values),
  kind: 'multi',
});

function profile(over: Partial<WizardE2eProfile> = {}): WizardE2eProfile {
  return { ...DEFAULT_E2E_PROFILE, ...over };
}

/** A CiState carrying just the fields the two overlay cases read. */
function state(over: Partial<CiState>): CiState {
  return {
    currentScreen: ScreenId.Run,
    pendingQuestion: null,
    taskNotice: null,
    setupQuestions: [],
    ...over,
  } as CiState;
}

describe('answerQuestions — the whole batch', () => {
  it('answers every question, not just the first', () => {
    const batch = answerQuestions(
      [text('host'), text('port'), text('database')],
      profile(),
    );
    expect(Object.keys(batch.answers)).toEqual(['host', 'port', 'database']);
  });

  it('falls back to the sentinel for free text with no rule and no options', () => {
    const batch = answerQuestions([text('host')], profile());
    expect(batch.answers.host).toBe(E2E_ANSWER_SENTINEL);
    expect(batch.sentinelIds).toEqual(['host']);
    expect(batch.answeredIds).toEqual([]);
  });

  it('takes the first option for a single-choice question', () => {
    const batch = answerQuestions(
      [single('sync', ['full', 'incremental'])],
      profile(),
    );
    expect(batch.answers.sync).toBe('full');
    expect(batch.answeredIds).toEqual(['sync']);
    expect(batch.sentinelIds).toEqual([]);
  });

  it('gives a multi-choice question an array answer', () => {
    const batch = answerQuestions([multi('tables', ['a', 'b'])], profile());
    expect(batch.answers.tables).toEqual(['a']);
  });

  it('wraps a routed answer in an array for a multi-choice question', () => {
    const batch = answerQuestions(
      [multi('tables', ['a', 'b'])],
      profile({ askAnswers: [{ match: 'tables', value: 'b' }] }),
    );
    expect(batch.answers.tables).toEqual(['b']);
  });

  it('reports answered and sentinel ids separately across a mixed batch', () => {
    const batch = answerQuestions(
      [text('prefix'), text('secret'), single('mode', ['cdc'])],
      profile({ askAnswers: [{ match: '^prefix$', value: 'e2e_42_' }] }),
    );
    expect(batch.answeredIds).toEqual(['prefix', 'mode']);
    expect(batch.sentinelIds).toEqual(['secret']);
  });
});

describe('answerQuestions — askAnswers matching', () => {
  it('matches the question id', () => {
    const batch = answerQuestions(
      [text('pg_host', 'Where does it live?')],
      profile({ askAnswers: [{ match: 'pg_host', value: 'db.internal' }] }),
    );
    expect(batch.answers.pg_host).toBe('db.internal');
  });

  it('falls back to matching the prompt when the id does not match', () => {
    const batch = answerQuestions(
      [text('q1', 'Postgres host')],
      profile({ askAnswers: [{ match: 'host', value: 'db.internal' }] }),
    );
    expect(batch.answers.q1).toBe('db.internal');
  });

  it('tries the id before the prompt, so an id match wins', () => {
    // Rule order alone cannot decide this: both rules are candidates for this
    // question. The id is the more specific signal, so it is tested first.
    const batch = answerQuestions(
      [text('port', 'the database host and port')],
      profile({
        askAnswers: [
          { match: 'host', value: 'from-prompt' },
          { match: 'port', value: 'from-id' },
        ],
      }),
    );
    expect(batch.answers.port).toBe('from-id');
  });

  it('takes the first matching rule when several match', () => {
    const batch = answerQuestions(
      [text('password')],
      profile({
        askAnswers: [
          { match: 'pass', value: 'first' },
          { match: 'password', value: 'second' },
        ],
      }),
    );
    expect(batch.answers.password).toBe('first');
  });

  it('matches case-insensitively', () => {
    const batch = answerQuestions(
      [text('q1', 'STRIPE API KEY')],
      profile({ askAnswers: [{ match: 'stripe', value: 'sk_test' }] }),
    );
    expect(batch.answers.q1).toBe('sk_test');
  });

  it('skips a malformed regex instead of failing the run', () => {
    const batch = answerQuestions(
      [text('host')],
      profile({
        askAnswers: [
          { match: '([unclosed', value: 'never' },
          { match: 'host', value: 'db.internal' },
        ],
      }),
    );
    expect(batch.answers.host).toBe('db.internal');
  });

  it('treats an empty resolved value as no match', () => {
    const batch = answerQuestions(
      [text('host')],
      profile({ askAnswers: [{ match: 'host', value: '' }] }),
    );
    expect(batch.answers.host).toBe(E2E_ANSWER_SENTINEL);
    expect(batch.sentinelIds).toEqual(['host']);
  });
});

/**
 * The skill names its own questions, so a rule matching on `id` or `prompt` is
 * matching agent-controlled text. A rule carrying a real credential therefore
 * answers only a question shaped so `wizard_ask` will vault the answer — free
 * text flagged sensitive. Anything else is refused, never answered.
 */
describe('answerQuestions — secret rules', () => {
  const secretRule = { match: 'stripe', value: 'sk_live_real', secret: true };

  it('answers a sensitive text question', () => {
    const batch = answerQuestions(
      [sensitiveText('stripe_api_key', 'Stripe API key')],
      profile({ askAnswers: [secretRule] }),
    );
    expect(batch.answers.stripe_api_key).toBe('sk_live_real');
    expect(batch.answeredIds).toEqual(['stripe_api_key']);
    expect(batch.refusedIds).toEqual([]);
  });

  it('refuses a text question the skill did not flag sensitive', () => {
    const batch = answerQuestions(
      [text('stripe_api_key', 'Stripe API key')],
      profile({ askAnswers: [secretRule] }),
    );
    expect(batch.answers.stripe_api_key).toBe(E2E_ANSWER_SENTINEL);
    expect(batch.refusedIds).toEqual(['stripe_api_key']);
    expect(batch.answeredIds).toEqual([]);
  });

  it('refuses a picker question wearing a credential name', () => {
    const batch = answerQuestions(
      [{ ...single('stripe_key', ['a', 'b']), sensitive: true }],
      profile({ askAnswers: [secretRule] }),
    );
    // Even flagged sensitive: `sensitive` is text-only, so a picker would come
    // back unvaulted. Refused rather than falling through to option 'a'.
    expect(batch.answers.stripe_key).toBe(E2E_ANSWER_SENTINEL);
    expect(batch.refusedIds).toEqual(['stripe_key']);
  });

  it('refuses on a prompt match too, not just an id match', () => {
    const batch = answerQuestions(
      [text('q1', 'Paste your Stripe key here')],
      profile({ askAnswers: [secretRule] }),
    );
    expect(batch.refusedIds).toEqual(['q1']);
    expect(JSON.stringify(batch.answers)).not.toContain('sk_live_real');
  });

  it('leaves non-secret rules alone — an ordinary field still answers', () => {
    const batch = answerQuestions(
      [text('host', 'Postgres host')],
      profile({ askAnswers: [secretRule, { match: 'host', value: 'db' }] }),
    );
    expect(batch.answers.host).toBe('db');
    expect(batch.refusedIds).toEqual([]);
  });

  it('is inert when the credential env var is unset — sentinel, not refusal', () => {
    const resolved = resolveE2eProfile(
      profile({ askAnswers: [{ ...secretRule, value: '${NOPE}' }] }),
      { env: {} },
    );
    const batch = answerQuestions([text('stripe_key', 'Stripe key')], resolved);
    expect(batch.sentinelIds).toEqual(['stripe_key']);
    expect(batch.refusedIds).toEqual([]);
  });

  it('survives interpolation with its secret flag intact', () => {
    const resolved = resolveE2eProfile(
      profile({ askAnswers: [{ ...secretRule, value: '${KEY}' }] }),
      { env: { KEY: 'sk_test_1' } },
    );
    expect(resolved.askAnswers?.[0].secret).toBe(true);
    const batch = answerQuestions([text('stripe_key', 'Stripe key')], resolved);
    expect(batch.refusedIds).toEqual(['stripe_key']);
  });
});

describe('resolveE2eProfile — env interpolation', () => {
  const base = profile({
    askAnswers: [
      { match: 'prefix', value: '${E2E_SOURCE_PREFIX}' },
      { match: 'host', value: '${E2E_PG_HOST}:${E2E_PG_PORT}' },
      { match: 'schema', value: 'public' },
    ],
  });

  it('expands ${VAR} from the supplied env', () => {
    const resolved = resolveE2eProfile(base, {
      env: { E2E_SOURCE_PREFIX: 'e2e_99_' },
    });
    expect(resolved.askAnswers?.[0].value).toBe('e2e_99_');
  });

  it('expands several references in one value', () => {
    const resolved = resolveE2eProfile(base, {
      env: { E2E_PG_HOST: 'db', E2E_PG_PORT: '5432' },
    });
    expect(resolved.askAnswers?.[1].value).toBe('db:5432');
  });

  it('resolves an unset var to an empty string, which becomes a sentinel', () => {
    const resolved = resolveE2eProfile(base, { env: {} });
    const batch = answerQuestions([text('prefix')], resolved);
    expect(batch.answers.prefix).toBe(E2E_ANSWER_SENTINEL);
    expect(batch.sentinelIds).toEqual(['prefix']);
  });

  it('leaves a literal value alone', () => {
    const resolved = resolveE2eProfile(base, { env: {} });
    expect(resolved.askAnswers?.[2].value).toBe('public');
  });

  it('merges E2E_ANSWERS_FILE rules ahead of the profile rules', () => {
    const resolved = resolveE2eProfile(base, {
      env: { E2E_SOURCE_PREFIX: 'from_env_' },
      extraAskAnswers: [{ match: 'prefix', value: 'from_file_' }],
    });
    const batch = answerQuestions([text('prefix')], resolved);
    expect(batch.answers.prefix).toBe('from_file_');
  });

  it('interpolates the merged rules too', () => {
    const resolved = resolveE2eProfile(base, {
      env: { OVERRIDE: 'yes' },
      extraAskAnswers: [{ match: 'prefix', value: '${OVERRIDE}' }],
    });
    expect(resolved.askAnswers?.[0].value).toBe('yes');
  });

  it('does not mutate the profile it was given', () => {
    resolveE2eProfile(base, { env: { E2E_SOURCE_PREFIX: 'x' } });
    expect(base.askAnswers?.[0].value).toBe('${E2E_SOURCE_PREFIX}');
  });
});

describe('resolveE2eProfile — notice policy', () => {
  it('keeps the profile default when no override is given', () => {
    expect(resolveE2eProfile(profile({ notice: 'decline' })).notice).toBe(
      'decline',
    );
  });

  it.each(['keep', 'decline'] as const)(
    'lets E2E_NOTICE=%s override the profile',
    (notice) => {
      const other = notice === 'keep' ? 'decline' : 'keep';
      expect(
        resolveE2eProfile(profile({ notice: other }), { notice }).notice,
      ).toBe(notice);
    },
  );

  it.each(['', 'maybe', 'KEEP'])(
    'ignores the unrecognised override %p',
    (notice) => {
      expect(
        resolveE2eProfile(profile({ notice: 'keep' }), { notice }).notice,
      ).toBe('keep');
    },
  );
});

describe('decideE2eAction — wizard_ask overlay', () => {
  const pending = {
    id: 'ask_1',
    source: 'data-warehouse-source-setup',
    questions: [text('host'), text('port')],
  };

  it('answers the whole batch in one commit', () => {
    const decision = decideE2eAction(
      state({ currentScreen: Overlay.WizardAsk, pendingQuestion: pending }),
      profile({ askAnswers: [{ match: 'host', value: 'db' }] }),
    );
    expect(decision.action?.id).toBe('answer_question');
    expect(decision.action?.params?.answers).toEqual({
      host: 'db',
      port: E2E_ANSWER_SENTINEL,
    });
  });

  it('reports the answered/sentinel split without any answer value', () => {
    const decision = decideE2eAction(
      state({ currentScreen: Overlay.WizardAsk, pendingQuestion: pending }),
      profile({ askAnswers: [{ match: 'host', value: 'db' }] }),
    );
    expect(decision.report).toEqual({
      kind: 'ask',
      id: 'ask_1',
      answeredIds: ['host'],
      sentinelIds: ['port'],
      refusedIds: [],
    });
    expect(JSON.stringify(decision.report)).not.toContain('db');
  });

  it('waits when the overlay is up but the question has not landed', () => {
    const decision = decideE2eAction(
      state({ currentScreen: Overlay.WizardAsk, pendingQuestion: null }),
      profile(),
    );
    expect(decision).toEqual({ wait: true });
  });

  it('waits on an empty batch rather than committing an empty answers map', () => {
    const decision = decideE2eAction(
      state({
        currentScreen: Overlay.WizardAsk,
        pendingQuestion: { ...pending, questions: [] },
      }),
      profile(),
    );
    expect(decision).toEqual({ wait: true });
  });
});

describe('decideE2eAction — task-notice overlay', () => {
  const notice = {
    title: 'Connect your data sources',
    items: ['Postgres', 'Stripe'],
    prompt: 'Connect these during setup?',
  };

  it('keeps the step by default', () => {
    const decision = decideE2eAction(
      state({ currentScreen: Overlay.TaskNotice, taskNotice: notice }),
      profile(),
    );
    expect(decision.action).toEqual({
      id: 'resolve_notice',
      params: { keep: true },
    });
    expect(decision.report).toEqual({
      kind: 'notice',
      title: notice.title,
      decision: 'keep',
    });
  });

  it('declines the step when the profile says so', () => {
    const decision = decideE2eAction(
      state({ currentScreen: Overlay.TaskNotice, taskNotice: notice }),
      profile({ notice: 'decline' }),
    );
    expect(decision.action).toEqual({
      id: 'resolve_notice',
      params: { keep: false },
    });
    expect(decision.report).toEqual({
      kind: 'notice',
      title: notice.title,
      decision: 'decline',
    });
  });

  it('follows E2E_NOTICE once it is resolved into the profile', () => {
    const resolved = resolveE2eProfile(profile({ notice: 'keep' }), {
      notice: 'decline',
    });
    const decision = decideE2eAction(
      state({ currentScreen: Overlay.TaskNotice, taskNotice: notice }),
      resolved,
    );
    expect(decision.action?.params).toEqual({ keep: false });
  });

  it('waits when the overlay is up but the notice has not landed', () => {
    const decision = decideE2eAction(
      state({ currentScreen: Overlay.TaskNotice, taskNotice: null }),
      profile(),
    );
    expect(decision).toEqual({ wait: true });
  });
});

describe('decideE2eAction purity', () => {
  it('reads nothing from process.env — the same inputs decide the same way', () => {
    const args = () =>
      [
        state({
          currentScreen: Overlay.TaskNotice,
          taskNotice: { title: 't', items: [], prompt: 'p' },
        }),
        profile({ notice: 'keep' }),
      ] as const;
    const before = decideE2eAction(...args());
    process.env.E2E_NOTICE = 'decline';
    try {
      expect(decideE2eAction(...args())).toEqual(before);
    } finally {
      delete process.env.E2E_NOTICE;
    }
  });
});

describe('E2E_DRIVABLE_SCREENS', () => {
  it('lists the task-notice overlay', () => {
    expect(E2E_DRIVABLE_SCREENS).toContain(Overlay.TaskNotice);
  });

  it('has a decideE2eAction case for every screen it lists', () => {
    // A listed screen with no case would return `{ wait: true }` forever,
    // stalling the run instead of failing it.
    const overlayState: Partial<Record<string, Partial<CiState>>> = {
      [Overlay.WizardAsk]: {
        pendingQuestion: {
          id: 'a',
          source: 's',
          questions: [text('q')],
        },
      },
      [Overlay.TaskNotice]: {
        taskNotice: { title: 't', items: [], prompt: 'p' },
      },
      [ScreenId.Setup]: {
        setupQuestions: [
          {
            key: 'router',
            message: 'router?',
            options: [{ label: 'a', value: 'a' }],
          },
        ],
      },
    };
    for (const screen of E2E_DRIVABLE_SCREENS) {
      const decision = decideE2eAction(
        state({ currentScreen: screen, ...(overlayState[screen] ?? {}) }),
        profile(),
      );
      expect({ screen, hasAction: Boolean(decision.action) }).toEqual({
        screen,
        hasAction: true,
      });
    }
  });
});

describe('warehouse-source profile', () => {
  const warehouse = profileFor(Program.WarehouseSource);

  it('is registered, not the happy-path default', () => {
    expect(warehouse.askAnswers?.length).toBeGreaterThan(0);
  });

  it('keeps the task notice and deletes installed skills', () => {
    expect(warehouse.notice).toBe('keep');
    expect(warehouse.skills).toBe('delete');
    expect(warehouse.mcp).toBe('skip');
  });

  it('routes each credential question to its own env var', () => {
    const env = {
      E2E_SOURCE_PREFIX: 'e2e_7_',
      E2E_STRIPE_API_KEY: 'sk_test_7',
      E2E_PG_HOST: 'db.internal',
      E2E_PG_PORT: '5432',
      E2E_PG_DATABASE: 'appdb',
      E2E_PG_USER: 'app',
      E2E_PG_PASSWORD: 'hunter2',
    };
    const resolved = resolveE2eProfile(warehouse, { env });
    const batch = answerQuestions(
      [
        text('prefix', 'Table prefix'),
        sensitiveText('stripe_api_key', 'Stripe API key'),
        text('host', 'Postgres host'),
        text('port', 'Port'),
        text('database', 'Database name'),
        text('user', 'Username'),
        sensitiveText('password', 'Password'),
      ],
      resolved,
    );
    expect(batch.answers).toEqual({
      prefix: 'e2e_7_',
      stripe_api_key: 'sk_test_7',
      host: 'db.internal',
      port: '5432',
      database: 'appdb',
      user: 'app',
      password: 'hunter2',
    });
    expect(batch.sentinelIds).toEqual([]);
    expect(batch.refusedIds).toEqual([]);
  });

  it('marks its credential-bearing rules secret', () => {
    const secretMatches = (warehouse.askAnswers ?? [])
      .filter((r) => r.secret)
      .map((r) => r.match);
    expect(secretMatches).toEqual(['stripe', 'password|passwd|pwd']);
  });

  it('withholds the API key from a question that is not sensitive', () => {
    const resolved = resolveE2eProfile(warehouse, {
      env: { E2E_STRIPE_API_KEY: 'sk_test_7' },
    });
    const batch = answerQuestions(
      [text('stripe_api_key', 'Stripe API key')],
      resolved,
    );
    expect(batch.answers.stripe_api_key).toBe(E2E_ANSWER_SENTINEL);
    expect(batch.refusedIds).toEqual(['stripe_api_key']);
  });

  it('sentinels every credential when the env is empty', () => {
    const resolved = resolveE2eProfile(warehouse, { env: {} });
    const batch = answerQuestions(
      [text('host', 'Postgres host'), sensitiveText('password', 'Password')],
      resolved,
    );
    expect(batch.sentinelIds).toEqual(['host', 'password']);
    expect(batch.refusedIds).toEqual([]);
  });
});
