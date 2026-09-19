import type { FrameworkConfig } from './framework-config.js';
import { Integration } from './shared/constants.js';
import { NEXTJS_AGENT_CONFIG } from './frameworks/nextjs/nextjs-wizard-agent.js';
import { NUXT_AGENT_CONFIG } from './frameworks/nuxt/nuxt-wizard-agent.js';
import { VUE_AGENT_CONFIG } from './frameworks/vue/vue-wizard-agent.js';
import { REACT_ROUTER_AGENT_CONFIG } from './frameworks/react-router/react-router-wizard-agent.js';
import { TANSTACK_ROUTER_AGENT_CONFIG } from './frameworks/tanstack-router/tanstack-router-wizard-agent.js';
import { TANSTACK_START_AGENT_CONFIG } from './frameworks/tanstack-start/tanstack-start-wizard-agent.js';
import { REACT_NATIVE_AGENT_CONFIG } from './frameworks/react-native/react-native-wizard-agent.js';
import { ANGULAR_AGENT_CONFIG } from './frameworks/angular/angular-wizard-agent.js';
import { ASTRO_AGENT_CONFIG } from './frameworks/astro/astro-wizard-agent.js';
import { DJANGO_AGENT_CONFIG } from './frameworks/django/django-wizard-agent.js';
import { FLASK_AGENT_CONFIG } from './frameworks/flask/flask-wizard-agent.js';
import { FASTAPI_AGENT_CONFIG } from './frameworks/fastapi/fastapi-wizard-agent.js';
import { LARAVEL_AGENT_CONFIG } from './frameworks/laravel/laravel-wizard-agent.js';
import { SVELTEKIT_AGENT_CONFIG } from './frameworks/svelte/svelte-wizard-agent.js';
import { FLUTTER_AGENT_CONFIG } from './frameworks/flutter/flutter-wizard-agent.js';
import { SWIFT_AGENT_CONFIG } from './frameworks/swift/swift-wizard-agent.js';
import { KMP_AGENT_CONFIG } from './frameworks/kmp/kmp-wizard-agent.js';
import { ANDROID_AGENT_CONFIG } from './frameworks/android/android-wizard-agent.js';
import { RAILS_AGENT_CONFIG } from './frameworks/rails/rails-wizard-agent.js';
import { ELIXIR_AGENT_CONFIG } from './frameworks/elixir/elixir-wizard-agent.js';
import { GO_AGENT_CONFIG } from './frameworks/go/go-wizard-agent.js';
import { JAVA_AGENT_CONFIG } from './frameworks/java/java-wizard-agent.js';
import { RUST_AGENT_CONFIG } from './frameworks/rust/rust-wizard-agent.js';
import { PYTHON_AGENT_CONFIG } from './frameworks/python/python-wizard-agent.js';
import { RUBY_AGENT_CONFIG } from './frameworks/ruby/ruby-wizard-agent.js';
import { JAVASCRIPT_NODE_AGENT_CONFIG } from './frameworks/javascript-node/javascript-node-wizard-agent.js';
import { JAVASCRIPT_WEB_AGENT_CONFIG } from './frameworks/javascript-web/javascript-web-wizard-agent.js';

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
  [Integration.flutter]: FLUTTER_AGENT_CONFIG,
  [Integration.kmp]: KMP_AGENT_CONFIG,
  [Integration.swift]: SWIFT_AGENT_CONFIG,
  [Integration.android]: ANDROID_AGENT_CONFIG,
  [Integration.rails]: RAILS_AGENT_CONFIG,
  [Integration.elixir]: ELIXIR_AGENT_CONFIG,
  [Integration.go]: GO_AGENT_CONFIG,
  [Integration.rust]: RUST_AGENT_CONFIG,
  [Integration.java]: JAVA_AGENT_CONFIG,
  [Integration.python]: PYTHON_AGENT_CONFIG,
  [Integration.ruby]: RUBY_AGENT_CONFIG,
  [Integration.javascriptNode]: JAVASCRIPT_NODE_AGENT_CONFIG,
  [Integration.javascript_web]: JAVASCRIPT_WEB_AGENT_CONFIG,
};
