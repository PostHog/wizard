/**
 * Cost-attribution contract for the two gateway generations.
 *
 * Run metadata has to leave the CLI in both shapes: the Python gateway reads
 * `X-POSTHOG-PROPERTY-<key>` headers one at a time, the slugless Go gateway
 * ignores those and merges only the `X-PostHog-Properties` JSON blob onto
 * `$ai_generation`. The wizard sent the per-property form alone, so every run
 * the Go gateway served lost `program_id`, `run_id`, `integration` and `build`
 * together — silently, since a dropped header is not an error. These tests pin
 * both shapes on both harnesses so it can't regress to one of them.
 */

import { buildAgentEnv } from '@lib/agent/agent-interface';
import { buildGatewayHeaders } from '@lib/agent/runner/harness/pi/gateway';
import { posthogPropertiesBlob } from '@utils/custom-headers';
import {
  POSTHOG_PROPERTIES_HEADER,
  POSTHOG_PROPERTY_HEADER_PREFIX,
} from '@lib/constants';

const RUN_TAGS = {
  program_id: 'posthog-integration',
  integration: 'nextjs',
  run_id: 'run-abc',
  build: '2.61.0',
};

describe('posthogPropertiesBlob', () => {
  it('emits the bare property names the gateway merges onto the event', () => {
    expect(JSON.parse(posthogPropertiesBlob(RUN_TAGS) ?? '{}')).toEqual(
      RUN_TAGS,
    );
  });

  it('strips a pre-applied header prefix — the blob wants properties, not headers', () => {
    const blob = posthogPropertiesBlob({
      [`${POSTHOG_PROPERTY_HEADER_PREFIX}program_id`]: 'audit',
    });

    expect(JSON.parse(blob ?? '{}')).toEqual({ program_id: 'audit' });
  });

  it('returns undefined for no metadata, so callers send no header at all', () => {
    // An empty blob would read as "attributed to nothing" rather than untagged.
    expect(posthogPropertiesBlob({})).toBeUndefined();
    expect(posthogPropertiesBlob({ program_id: '' })).toBeUndefined();
  });

  it('escapes newlines so a value cannot forge a second header', () => {
    const blob = posthogPropertiesBlob({ program_id: 'a\nX-Evil: 1' });

    expect(blob).not.toContain('\n');
    expect(JSON.parse(blob ?? '{}')).toEqual({ program_id: 'a\nX-Evil: 1' });
  });
});

describe('buildAgentEnv (anthropic harness)', () => {
  it('sends both shapes, so either gateway can attribute the run', () => {
    const encoded = buildAgentEnv(RUN_TAGS, {});

    expect(encoded).toContain(
      'X-POSTHOG-PROPERTY-program_id: posthog-integration',
    );
    expect(encoded).toContain(
      `${POSTHOG_PROPERTIES_HEADER}: ${JSON.stringify(RUN_TAGS)}`,
    );
  });

  it('keeps the blob on one line — the header block is newline-delimited', () => {
    const blobLines = buildAgentEnv(RUN_TAGS, {})
      .split('\n')
      .filter((line) => line.startsWith(POSTHOG_PROPERTIES_HEADER));

    expect(blobLines).toHaveLength(1);
  });

  it('omits the blob when there is nothing to attribute', () => {
    expect(buildAgentEnv({}, {})).not.toContain(POSTHOG_PROPERTIES_HEADER);
  });
});

describe('buildGatewayHeaders (pi harness)', () => {
  it('sends both shapes too — the harness must not change attribution', () => {
    const headers = buildGatewayHeaders(RUN_TAGS, {});

    expect(headers[`${POSTHOG_PROPERTY_HEADER_PREFIX}program_id`]).toBe(
      'posthog-integration',
    );
    expect(JSON.parse(headers[POSTHOG_PROPERTIES_HEADER] ?? '{}')).toEqual(
      RUN_TAGS,
    );
  });

  it('leaves the existing bedrock-fallback and flag headers alone', () => {
    const headers = buildGatewayHeaders(RUN_TAGS, {
      wizardThing: 'variant-a',
      unrelatedFlag: 'nope',
    });

    expect(headers['x-posthog-use-bedrock-fallback']).toBe('true');
    expect(headers['X-POSTHOG-FLAG-WIZARDTHING']).toBe('variant-a');
    expect(headers).not.toHaveProperty('X-POSTHOG-FLAG-UNRELATEDFLAG');
  });

  it('omits the blob when there is nothing to attribute', () => {
    expect(buildGatewayHeaders({}, {})).not.toHaveProperty(
      POSTHOG_PROPERTIES_HEADER,
    );
  });
});
