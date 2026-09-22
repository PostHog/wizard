import { ASTRO_AGENT_CONFIG } from '@programs/frameworks/astro/astro-wizard-agent';
import { AstroRenderingMode } from '@programs/frameworks/astro/utils';
import { DJANGO_AGENT_CONFIG } from '@programs/frameworks/django/django-wizard-agent';
import { DjangoProjectType } from '@programs/frameworks/django/utils';
import { FASTAPI_AGENT_CONFIG } from '@programs/frameworks/fastapi/fastapi-wizard-agent';
import { FastAPIProjectType } from '@programs/frameworks/fastapi/utils';
import { FLASK_AGENT_CONFIG } from '@programs/frameworks/flask/flask-wizard-agent';
import { FlaskProjectType } from '@programs/frameworks/flask/utils';
import { LARAVEL_AGENT_CONFIG } from '@programs/frameworks/laravel/laravel-wizard-agent';
import { LaravelProjectType } from '@programs/frameworks/laravel/utils';
import { NEXTJS_AGENT_CONFIG } from '@programs/frameworks/nextjs/nextjs-wizard-agent';
import { NextJsRouter } from '@programs/frameworks/nextjs/utils';
import { RAILS_AGENT_CONFIG } from '@programs/frameworks/rails/rails-wizard-agent';
import { RailsProjectType } from '@programs/frameworks/rails/utils';
import { REACT_NATIVE_AGENT_CONFIG } from '@programs/frameworks/react-native/react-native-wizard-agent';
import { ReactNativeVariant } from '@programs/frameworks/react-native/utils';
import { REACT_ROUTER_AGENT_CONFIG } from '@programs/frameworks/react-router/react-router-wizard-agent';
import { ReactRouterMode } from '@programs/frameworks/react-router/utils';
import { TANSTACK_ROUTER_AGENT_CONFIG } from '@programs/frameworks/tanstack-router/tanstack-router-wizard-agent';
import { TanStackRouterMode } from '@programs/frameworks/tanstack-router/utils';

describe('framework detection labels', () => {
  it.each([
    [
      'Next.js app router',
      () =>
        NEXTJS_AGENT_CONFIG.metadata.getDetectedFrameworkLabel?.({
          router: NextJsRouter.APP_ROUTER,
        }),
      'Next.js app router 📱',
    ],
    [
      'Next.js pages router',
      () =>
        NEXTJS_AGENT_CONFIG.metadata.getDetectedFrameworkLabel?.({
          router: NextJsRouter.PAGES_ROUTER,
        }),
      'Next.js pages router 📃',
    ],
    [
      'Next.js unknown router',
      () => NEXTJS_AGENT_CONFIG.metadata.getDetectedFrameworkLabel?.({}),
      undefined,
    ],
    [
      'Astro SSR',
      () =>
        ASTRO_AGENT_CONFIG.metadata.getDetectedFrameworkLabel?.({
          renderingMode: AstroRenderingMode.SSR,
        }),
      'Astro Server (SSR)',
    ],
    [
      'React Router data mode',
      () =>
        REACT_ROUTER_AGENT_CONFIG.metadata.getDetectedFrameworkLabel?.({
          routerMode: ReactRouterMode.V7_DATA,
        }),
      'React Router v7 Data mode',
    ],
    [
      'TanStack file routes',
      () =>
        TANSTACK_ROUTER_AGENT_CONFIG.metadata.getDetectedFrameworkLabel?.({
          routerMode: TanStackRouterMode.FILE_BASED,
        }),
      'TanStack Router File-based routing',
    ],
    [
      'Django Wagtail',
      () =>
        DJANGO_AGENT_CONFIG.metadata.getDetectedFrameworkLabel?.({
          projectType: DjangoProjectType.WAGTAIL,
        }),
      'Django with Wagtail CMS',
    ],
    [
      'Django standard',
      () =>
        DJANGO_AGENT_CONFIG.metadata.getDetectedFrameworkLabel?.({
          projectType: DjangoProjectType.STANDARD,
        }),
      'Django',
    ],
    [
      'Flask RESTX',
      () =>
        FLASK_AGENT_CONFIG.metadata.getDetectedFrameworkLabel?.({
          projectType: FlaskProjectType.RESTX,
        }),
      'Flask-RESTX',
    ],
    [
      'Flask standard',
      () =>
        FLASK_AGENT_CONFIG.metadata.getDetectedFrameworkLabel?.({
          projectType: FlaskProjectType.STANDARD,
        }),
      'Flask',
    ],
    [
      'FastAPI fullstack',
      () =>
        FASTAPI_AGENT_CONFIG.metadata.getDetectedFrameworkLabel?.({
          projectType: FastAPIProjectType.FULLSTACK,
        }),
      'FastAPI fullstack with templates',
    ],
    [
      'FastAPI standard',
      () =>
        FASTAPI_AGENT_CONFIG.metadata.getDetectedFrameworkLabel?.({
          projectType: FastAPIProjectType.STANDARD,
        }),
      'FastAPI',
    ],
    [
      'Laravel Inertia',
      () =>
        LARAVEL_AGENT_CONFIG.metadata.getDetectedFrameworkLabel?.({
          projectType: LaravelProjectType.INERTIA,
        }),
      'Laravel with Inertia.js',
    ],
    [
      'Laravel standard',
      () =>
        LARAVEL_AGENT_CONFIG.metadata.getDetectedFrameworkLabel?.({
          projectType: LaravelProjectType.STANDARD,
        }),
      'Laravel',
    ],
    [
      'Rails API',
      () =>
        RAILS_AGENT_CONFIG.metadata.getDetectedFrameworkLabel?.({
          projectType: RailsProjectType.API,
        }),
      'Rails API-only',
    ],
    [
      'Rails standard',
      () =>
        RAILS_AGENT_CONFIG.metadata.getDetectedFrameworkLabel?.({
          projectType: RailsProjectType.STANDARD,
        }),
      'Rails',
    ],
    [
      'React Native Expo',
      () =>
        REACT_NATIVE_AGENT_CONFIG.metadata.getDetectedFrameworkLabel?.({
          variant: ReactNativeVariant.EXPO,
        }),
      'Expo 📱',
    ],
    [
      'React Native bare',
      () =>
        REACT_NATIVE_AGENT_CONFIG.metadata.getDetectedFrameworkLabel?.({
          variant: ReactNativeVariant.REACT_NATIVE,
        }),
      'React Native 📱',
    ],
  ])('keeps the %s label', (_name, getLabel, expected) => {
    expect(getLabel()).toBe(expected);
  });
});
