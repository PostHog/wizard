import { describe, expect, it } from 'vitest';
import { Integration } from '@shared/constants';
import { DiscoveredFeature } from '@shared/discovered-feature';
import { buildSession } from '@services/session/wizard-session';
import { FRAMEWORK_REGISTRY } from '@services/frameworks/registry';
import { DETECTED_WAREHOUSE_SOURCES_KEY } from '@services/warehouse-sources/detect';
import {
  RUN_PROJECT,
  TRAITS,
  getProject,
  getTraits,
  toMatchKeys,
} from '@services/project-traits/traits';

const session = (overrides: Parameters<typeof buildSession>[0] = {}) =>
  buildSession({ installDir: '/repo', ...overrides });

describe('getTraits', () => {
  it('has no traits before detection settles anything', () => {
    expect(getTraits(session())).toEqual({});
  });

  it('reads the framework from the session', () => {
    const value = session();
    value.integration = Integration.django;
    expect(getTraits(value)).toEqual({
      framework: { value: Integration.django, source: 'static' },
    });
  });

  it.each([
    [Integration.nextjs, { router: 'pages-router' }, 'pages-router'],
    [Integration.reactRouter, { routerMode: 'v7-framework' }, 'v7-framework'],
    [Integration.tanstackRouter, { routerMode: 'code-based' }, 'code-based'],
    [Integration.astro, { renderingMode: 'ssr' }, 'ssr'],
    [Integration.reactNative, { variant: 'expo' }, 'expo'],
    [Integration.nuxt, { versionBucket: '3.0-3.6' }, '3.0-3.6'],
  ])('reads the %s variant its config gathered', (framework, context, id) => {
    const value = session();
    value.integration = framework;
    value.frameworkContext = context;
    expect(getTraits(value).variant).toEqual({ value: id, source: 'static' });
  });

  it('has no variant until the framework context is gathered', () => {
    const value = session();
    value.integration = Integration.nextjs;
    expect(getTraits(value).variant).toBeUndefined();
  });

  it('covers every framework that declares a variant', () => {
    const declaring = Object.values(Integration).filter(
      (id) => FRAMEWORK_REGISTRY[id].metadata.getVariant,
    );
    expect(declaring.sort()).toEqual(
      [
        Integration.astro,
        Integration.nextjs,
        Integration.nuxt,
        Integration.reactNative,
        Integration.reactRouter,
        Integration.tanstackRouter,
      ].sort(),
    );
  });

  it('says a project calls an LLM API only when an LLM SDK is a dependency', () => {
    const value = session();
    value.discoveredFeatures = [DiscoveredFeature.Stripe];
    expect(getTraits(value).callsLlmApi).toBeUndefined();
    value.discoveredFeatures = [DiscoveredFeature.LLM];
    expect(getTraits(value).callsLlmApi).toEqual({
      value: 'yes',
      source: 'static',
    });
  });

  it('reads the MCP server candidates and the warehouse sources', () => {
    const value = session();
    value.mcpServerCandidates = ['apps/mcp'];
    value.frameworkContext = {
      [DETECTED_WAREHOUSE_SOURCES_KEY]: [
        { kind: 'Stripe', label: 'Stripe', mode: 'guided', matchedSignal: 'x' },
        {
          kind: 'Postgres',
          label: 'Postgres',
          mode: 'guided',
          matchedSignal: 'y',
        },
      ],
    };
    const traits = getTraits(value);
    expect(traits.mcpServers?.value).toEqual(['apps/mcp']);
    expect(traits.warehouseSources?.value).toEqual(['Stripe', 'Postgres']);
  });

  it('knows only the directory the run works in', () => {
    const value = session();
    value.integration = Integration.django;
    expect(getTraits(value, 'apps/web')).toEqual({});
    expect(getProject(value)).toEqual({
      path: RUN_PROJECT,
      traits: getTraits(value),
    });
  });
});

describe('toMatchKeys', () => {
  it('carries the framework and no other trait', () => {
    const value = session();
    value.integration = Integration.nextjs;
    value.frameworkContext = { router: 'pages-router' };
    value.discoveredFeatures = [DiscoveredFeature.LLM];
    value.mcpServerCandidates = ['apps/mcp'];
    expect(toMatchKeys(getTraits(value))).toEqual({
      framework: [Integration.nextjs],
    });
  });

  it('is empty when no framework is detected', () => {
    expect(toMatchKeys(getTraits(session()))).toEqual({});
  });

  it('matches on the framework alone', () => {
    const matching = Object.entries(TRAITS)
      .filter(([, definition]) => definition.matchKey)
      .map(([name]) => name);
    expect(matching).toEqual(['framework']);
  });
});
