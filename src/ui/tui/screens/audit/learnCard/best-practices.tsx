import { Box, Text } from 'ink';
import { Colors } from '../../../styles.js';
import { SlideFrame } from './SlideFrame.js';

const mark = (ok: boolean) => (
  <Text color={ok ? 'green' : 'red'}>{ok ? '✓' : '×'}</Text>
);

const ExampleRow = ({ ok, label }: { ok: boolean; label: string }) => (
  <Text>
    {'  '}
    {mark(ok)} <Text dimColor>{label}</Text>
  </Text>
);

const FunnelRow = ({
  indent,
  bar,
  label,
  percent,
  users,
}: {
  indent: number;
  bar: string;
  label: string;
  percent: string;
  users: string;
}) => (
  <>
    <Text>
      {' '.repeat(indent)}
      <Text color="gray">╲</Text>
      <Text color="cyan">{bar}</Text>
      <Text color="gray">╱</Text> <Text>{label}</Text>{' '}
      <Text bold color="green">
        {percent}
      </Text>
    </Text>
    <Text dimColor>
      {' '.repeat(indent + 3)}
      {users}
    </Text>
  </>
);

const FunnelVisual = () => (
  <Box flexDirection="column" marginBottom={1}>
    <Text bold color={Colors.accent}>
      Core funnel
    </Text>
    <FunnelRow
      indent={0}
      bar="████████████████████████████"
      label="signup"
      percent="100%"
      users="1,240 users"
    />
    <FunnelRow
      indent={2}
      bar="██████████████████████"
      label="activate"
      percent="72%"
      users="893 users  ↘ 347"
    />
    <FunnelRow
      indent={5}
      bar="███████████████"
      label="return"
      percent="46%"
      users="570 users  ↘ 323"
    />
    <FunnelRow
      indent={9}
      bar="███████"
      label="paid"
      percent="18%"
      users="223 users  ↘ 347"
    />
    <Text dimColor>{'     watch the biggest drop-off first'}</Text>
  </Box>
);

const NamingVisual = () => (
  <Box flexDirection="column" marginBottom={1}>
    <Text bold color={Colors.accent}>
      Event naming
    </Text>
    <Box>
      <Box flexDirection="column" width={21}>
        <Text color="green" bold>
          Good
        </Text>
        <ExampleRow ok label="signup:started" />
        <ExampleRow ok label="billing:paid" />
        <ExampleRow ok label="invite:sent" />
        <ExampleRow ok label="report:exported" />
        <ExampleRow ok label="survey:sent" />
        <ExampleRow ok label="project:created" />
      </Box>
      <Box flexDirection="column" width={25}>
        <Text color="red" bold>
          Bad
        </Text>
        <ExampleRow ok={false} label="Clicked Button" />
        <ExampleRow ok={false} label="tapped_12345" />
        <ExampleRow ok={false} label="user did a thing" />
        <ExampleRow ok={false} label="Exported CSV!!!" />
        <ExampleRow ok={false} label="nps_10_submitted" />
        <ExampleRow ok={false} label="create_project_jane" />
      </Box>
    </Box>
  </Box>
);

const PropertiesVisual = () => (
  <Box flexDirection="column" marginBottom={1}>
    <Text bold color={Colors.accent}>
      Event shape
    </Text>
    <Box>
      <Box flexDirection="column" width={24}>
        <Text color="green" bold>
          Good
        </Text>
        <ExampleRow ok label="page_viewed" />
        <Text dimColor>{'    { page_name }'}</Text>
        <ExampleRow ok label="feature_used" />
        <Text dimColor>{'    { feature_name }'}</Text>
      </Box>
      <Box flexDirection="column" width={22}>
        <Text color="red" bold>
          Bad
        </Text>
        <ExampleRow ok={false} label="page_/pricing" />
        <ExampleRow ok={false} label="export_csv_used" />
        <ExampleRow ok={false} label="button_4512" />
      </Box>
    </Box>
  </Box>
);

const DistinctIdVisual = () => (
  <Box flexDirection="column" marginBottom={1}>
    <Text bold color={Colors.accent}>
      distinct_id
    </Text>
    <Box height={1} />
    <Text>
      <Text color="green">browser</Text>
      <Text dimColor>{'  ──  user_42  ──  '}</Text>
      <Text color="green">api</Text>
      <Text dimColor>{'  ──  '}</Text>
      <Text color="green">billing</Text>
    </Text>
    <Text dimColor>{'              one person profile'}</Text>
    <Box height={1} />
    <Text>
      <Text color="red">web:user_42</Text>
      <Text dimColor>{'     +     '}</Text>
      <Text color="red">api:USER_42</Text>
    </Text>
    <Text dimColor>{'              fragmented users'}</Text>
  </Box>
);

const ActivationVisual = () => (
  <Box flexDirection="column" marginBottom={1}>
    <Text bold color={Colors.accent}>
      Activation
    </Text>
    <Box>
      <Box flexDirection="column" width={23}>
        <Text color="green" bold>
          Activated
        </Text>
        <ExampleRow ok label="invited teammate" />
        <ExampleRow ok label="created dashboard" />
        <ExampleRow ok label="ran first query" />
      </Box>
      <Box flexDirection="column" width={23}>
        <Text color="red" bold>
          Not enough
        </Text>
        <ExampleRow ok={false} label="visited homepage" />
        <ExampleRow ok={false} label="opened menu" />
        <ExampleRow ok={false} label="hovered button" />
      </Box>
    </Box>
  </Box>
);

const BackendTrackingVisual = () => (
  <Box flexDirection="column" marginBottom={1}>
    <Text bold color={Colors.accent}>
      Server-side
    </Text>
    <Text dimColor>{'browser can miss critical events'}</Text>
    <Text>
      <Text color="gray">{'client '}</Text>
      <Text color="red">✕</Text>
      <Text dimColor>{' adblock / tab closed / flaky net'}</Text>
    </Text>
    <Text>
      <Text color="gray">{'server '}</Text>
      <Text color="green">✓</Text>
      <Text dimColor>{' signup, payment, upgrade, invite'}</Text>
    </Text>
  </Box>
);

const InternalTrafficVisual = () => (
  <Box flexDirection="column" marginBottom={1}>
    <Text bold color={Colors.accent}>
      Filter guard
    </Text>
    <Text>
      <Text color="red">employee</Text>
      <Text dimColor>{'  '}</Text>
      <Text color="red">qa</Text>
      <Text dimColor>{'  '}</Text>
      <Text color="red">staging</Text>
      <Text dimColor>{'  '}</Text>
      <Text color="red">localhost</Text>
    </Text>
    <Text dimColor>{'        │'}</Text>
    <Text>
      <Text dimColor>{'        ▼  '}</Text>
      <Text color="yellow">drop before capture</Text>
    </Text>
    <Text>
      <Text dimColor>{'        ▼  '}</Text>
      <Text color="green">clean dashboards</Text>
    </Text>
  </Box>
);

const ReplayDropoffVisual = () => (
  <Box flexDirection="column" marginBottom={1}>
    <Text bold color={Colors.accent}>
      Drop-off replay
    </Text>
    <Text color="gray">{'┌ checkout step ─────────────────┐'}</Text>
    <Text>
      <Text color="gray">{'│ '}</Text>
      <Text>cart_submit</Text>
      <Text dimColor>{' recorded'}</Text>
      <Text color="gray">{'                  │'}</Text>
    </Text>
    <Text>
      <Text color="gray">{'│ '}</Text>
      <Text color="red">Pay button disabled</Text>
      <Text color="gray">{'             │'}</Text>
    </Text>
    <Text>
      <Text color="gray">{'│ '}</Text>
      <Text dimColor>{'console: missing price_id'}</Text>
      <Text color="gray">{'          │'}</Text>
    </Text>
    <Text>
      <Text color="gray">{'│ '}</Text>
      <Text color="red">user exits checkout</Text>
      <Text color="gray">{'              │'}</Text>
    </Text>
    <Text color="gray">{'└────────────────────────────────┘'}</Text>
  </Box>
);

export const SignupEventSlide = () => (
  <SlideFrame visual={<FunnelVisual />}>
    Start with growth events. Capture signup, subscription, and purchase
    explicitly so activation, retention, and LTV are grounded in real moments.
  </SlideFrame>
);

export const EventNamesVocabularySlide = () => (
  <SlideFrame visual={<NamingVisual />}>
    Use a naming convention before your event list grows teeth. Lowercase,
    snake_case, and category:object_action keep analytics searchable.
  </SlideFrame>
);

export const EventPropertiesSlide = () => (
  <SlideFrame visual={<PropertiesVisual />}>
    Keep event and property names static. Variable data belongs in property
    values, not interpolated names that create endless definitions.
  </SlideFrame>
);

export const StableDistinctIdSlide = () => (
  <SlideFrame visual={<DistinctIdVisual />}>
    Design distinct IDs carefully. These IDs should be stable, never reused, and
    consistent across frontend and backend code.
  </SlideFrame>
);

export const ActivationThresholdSlide = () => (
  <SlideFrame visual={<ActivationVisual />}>
    Activation is a threshold. Pick the behavior that proves a user has actually
    felt the value.
  </SlideFrame>
);

export const BackendTrackingSlide = () => (
  <SlideFrame visual={<BackendTrackingVisual />}>
    Prefer backend tracking for critical numbers. Browsers can block, interrupt,
    or delay frontend events; your server is usually the steadier witness.
  </SlideFrame>
);

export const InternalTrafficSlide = () => (
  <SlideFrame visual={<InternalTrafficVisual />}>
    Filter employee, QA, staging, localhost, and test traffic before your own
    team trains the dashboard to lie.
  </SlideFrame>
);

export const CoreFlowEvaluationSlide = () => (
  <SlideFrame visual={<FunnelVisual />}>
    Audit the core product journey first: signup, activation, retention action,
    and conversion. If those are solid, every other analysis gets easier.
  </SlideFrame>
);

export const DropoffQuestionSlide = () => (
  <SlideFrame visual={<ReplayDropoffVisual />}>
    Reviewing your funnel should answer one human question: where do users drop
    off in the core flow, and why? Try asking PostHog AI to help you build
    funnels and watch replays.
  </SlideFrame>
);
