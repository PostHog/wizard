import type { FrameworkConfig } from './framework-config';
import { Integration } from './constants';
import { NEXTJS_AGENT_CONFIG } from '../frameworks/nextjs/nextjs-wizard-agent';
import { NUXT_AGENT_CONFIG } from '../frameworks/nuxt/nuxt-wizard-agent';
import { VUE_AGENT_CONFIG } from '../frameworks/vue/vue-wizard-agent';
import { REACT_ROUTER_AGENT_CONFIG } from '../frameworks/react-router/react-router-wizard-agent';
import { TANSTACK_ROUTER_AGENT_CONFIG } from '../frameworks/tanstack-router/tanstack-router-wizard-agent';
import { TANSTACK_START_AGENT_CONFIG } from '../frameworks/tanstack-start/tanstack-start-wizard-agent';
import { REACT_NATIVE_AGENT_CONFIG } from '../frameworks/react-native/react-native-wizard-agent';
import { ANGULAR_AGENT_CONFIG } from '../frameworks/angular/angular-wizard-agent';
import { ASTRO_AGENT_CONFIG } from '../frameworks/astro/astro-wizard-agent';
import { DJANGO_AGENT_CONFIG } from '../frameworks/django/django-wizard-agent';
import { FLASK_AGENT_CONFIG } from '../frameworks/flask/flask-wizard-agent';
import { FASTAPI_AGENT_CONFIG } from '../frameworks/fastapi/fastapi-wizard-agent';
import { LARAVEL_AGENT_CONFIG } from '../frameworks/laravel/laravel-wizard-agent';
import { SVELTEKIT_AGENT_CONFIG } from '../frameworks/svelte/svelte-wizard-agent';
import { SWIFT_AGENT_CONFIG } from '../frameworks/swift/swift-wizard-agent';
import { ANDROID_AGENT_CONFIG } from '../frameworks/android/android-wizard-agent';
import { RAILS_AGENT_CONFIG } from '../frameworks/rails/rails-wizard-agent';
import { PYTHON_AGENT_CONFIG } from '../frameworks/python/python-wizard-agent';
import { RUBY_AGENT_CONFIG } from '../frameworks/ruby/ruby-wizard-agent';
import { JAVASCRIPT_WEB_AGENT_CONFIG } from '../frameworks/javascript-web/javascript-web-wizard-agent';
import { JAVASCRIPT_NODE_AGENT_CONFIG } from '../frameworks/javascript-node/javascript-node-wizard-agent';

export const FRAMEWORK_REGISTRY: Record<Integration, FrameworkConfig> = {
  [Integration.nextjs]: NEXTJS_AGENT_CONFIG,
  [Integration.nuxt]: NUXT_AGENT_CONFIG,
  [Integration.vue]: VUE_AGENT_CONFIG,
  [Integration.tanstackStart]: TANSTACK_START_AGENT_CONFIG,
  [Integration.reactRouter]: REACT_ROUTER_AGENT_CONFIG,
  [Integration.tanstackRouter]: TANSTACK_ROUTER_AGENT_CONFIG,
  [Integration.reactNative]: REACT_NATIVE_AGENT_CONFIG,
  [Integration.angular]: ANGULAR_AGENT_CONFIG,
  [Integration.astro]: ASTRO_AGENT_CONFIG,
  [Integration.django]: DJANGO_AGENT_CONFIG,
  [Integration.flask]: FLASK_AGENT_CONFIG,
  [Integration.fastapi]: FASTAPI_AGENT_CONFIG,
  [Integration.laravel]: LARAVEL_AGENT_CONFIG,
  [Integration.sveltekit]: SVELTEKIT_AGENT_CONFIG,
  [Integration.swift]: SWIFT_AGENT_CONFIG,
  [Integration.android]: ANDROID_AGENT_CONFIG,
  [Integration.rails]: RAILS_AGENT_CONFIG,
  [Integration.python]: PYTHON_AGENT_CONFIG,
  [Integration.ruby]: RUBY_AGENT_CONFIG,
  [Integration.javascript_web]: JAVASCRIPT_WEB_AGENT_CONFIG,
  [Integration.javascriptNode]: JAVASCRIPT_NODE_AGENT_CONFIG,
};
