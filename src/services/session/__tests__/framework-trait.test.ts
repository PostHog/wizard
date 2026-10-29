/** Every framework write on a session records the framework trait with its source. */
import { Integration } from '@shared/constants';
import { analytics } from '@utils/analytics';
import { frameworkTraitMismatch } from '../../project-traits/traits';
import { SessionStore } from '../session-store';
import { buildSession } from '../wizard-session';

vi.mock('@utils/analytics', () => ({
  analytics: { setTag: vi.fn() },
}));

describe('framework trait', () => {
  it('records `--integration` as the person’s pick', () => {
    expect(buildSession({}).projectTraits).toEqual({});
    expect(
      buildSession({ integration: Integration.django }).projectTraits,
    ).toEqual({ framework: { value: 'django', source: 'user' } });
  });

  it('records a detected framework as static, and tags its source', () => {
    const store = new SessionStore(buildSession({}));
    store.setFrameworkConfig(Integration.nextjs, null);
    expect(store.session.integration).toBe('nextjs');
    expect(store.session.projectTraits.framework).toEqual({
      value: 'nextjs',
      source: 'static',
    });
    expect(analytics.setTag).toHaveBeenCalledWith('framework_source', 'static');
    expect(frameworkTraitMismatch(store.session)).toBeUndefined();
  });

  it('records a picked framework as the person’s, replacing detection’s', () => {
    const store = new SessionStore(buildSession({}));
    store.setFrameworkConfig(Integration.nextjs, null);
    store.setFrameworkConfig(Integration.nuxt, null, 'user');
    expect(store.session.projectTraits.framework).toEqual({
      value: 'nuxt',
      source: 'user',
    });
  });

  it('clears the trait with the framework', () => {
    const store = new SessionStore(
      buildSession({ integration: Integration.flask }),
    );
    store.setFrameworkConfig(null, null);
    expect(store.session.projectTraits).toEqual({});
    expect(frameworkTraitMismatch(store.session)).toBeUndefined();
  });
});
