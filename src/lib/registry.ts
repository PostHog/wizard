import type { FrameworkConfig } from './framework-config';
import { Integration } from './constants';
import { NEXTJS_AGENT_CONFIG } from '../nextjs/nextjs-wizard-agent';
import { NUXT_AGENT_CONFIG } from '../nuxt/nuxt-wizard-agent';
import { VUE_AGENT_CONFIG } from '../vue/vue-wizard-agent';
import { REACT_ROUTER_AGENT_CONFIG } from '../react-router/react-router-wizard-agent';
import { TANSTACK_ROUTER_AGENT_CONFIG } from '../tanstack-router/tanstack-router-wizard-agent';
import { TANSTACK_START_AGENT_CONFIG } from '../tanstack-start/tanstack-start-wizard-agent';
import { ANGULAR_AGENT_CONFIG } from '../angular/angular-wizard-agent';
import { ASTRO_AGENT_CONFIG } from '../astro/astro-wizard-agent';
import { DJANGO_AGENT_CONFIG } from '../django/django-wizard-agent';
import { FLASK_AGENT_CONFIG } from '../flask/flask-wizard-agent';
import { FASTAPI_AGENT_CONFIG } from '../fastapi/fastapi-wizard-agent';
import { LARAVEL_AGENT_CONFIG } from '../laravel/laravel-wizard-agent';
import { SVELTEKIT_AGENT_CONFIG } from '../svelte/svelte-wizard-agent';
import { SWIFT_AGENT_CONFIG } from '../swift/swift-wizard-agent';
import { PYTHON_AGENT_CONFIG } from '../python/python-wizard-agent';

export const FRAMEWORK_REGISTRY: Record<Integration, FrameworkConfig> = {
  [Integration.nextjs]: NEXTJS_AGENT_CONFIG,
  [Integration.nuxt]: NUXT_AGENT_CONFIG,
  [Integration.vue]: VUE_AGENT_CONFIG,
  [Integration.tanstackStart]: TANSTACK_START_AGENT_CONFIG,
  [Integration.reactRouter]: REACT_ROUTER_AGENT_CONFIG,
  [Integration.tanstackRouter]: TANSTACK_ROUTER_AGENT_CONFIG,
  [Integration.angular]: ANGULAR_AGENT_CONFIG,
  [Integration.astro]: ASTRO_AGENT_CONFIG,
  [Integration.django]: DJANGO_AGENT_CONFIG,
  [Integration.flask]: FLASK_AGENT_CONFIG,
  [Integration.fastapi]: FASTAPI_AGENT_CONFIG,
  [Integration.laravel]: LARAVEL_AGENT_CONFIG,
  [Integration.sveltekit]: SVELTEKIT_AGENT_CONFIG,
  [Integration.swift]: SWIFT_AGENT_CONFIG,
  [Integration.python]: PYTHON_AGENT_CONFIG,
};
