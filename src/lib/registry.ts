import type { FrameworkConfig } from './framework-config';
import { Integration } from './constants';
import { NEXTJS_AGENT_CONFIG } from '../nextjs/nextjs-wizard-agent';
import { REACT_ROUTER_AGENT_CONFIG } from '../react-router/react-router-wizard-agent';
import { TANSTACK_ROUTER_AGENT_CONFIG } from '../tanstack-router/tanstack-router-wizard-agent';
import { TANSTACK_START_AGENT_CONFIG } from '../tanstack-start/tanstack-start-wizard-agent';
import { DJANGO_AGENT_CONFIG } from '../django/django-wizard-agent';
import { FLASK_AGENT_CONFIG } from '../flask/flask-wizard-agent';
import { LARAVEL_AGENT_CONFIG } from '../laravel/laravel-wizard-agent';

export const FRAMEWORK_REGISTRY: Record<Integration, FrameworkConfig> = {
  [Integration.nextjs]: NEXTJS_AGENT_CONFIG,
  [Integration.tanstackStart]: TANSTACK_START_AGENT_CONFIG,
  [Integration.reactRouter]: REACT_ROUTER_AGENT_CONFIG,
  [Integration.tanstackRouter]: TANSTACK_ROUTER_AGENT_CONFIG,
  [Integration.django]: DJANGO_AGENT_CONFIG,
  [Integration.flask]: FLASK_AGENT_CONFIG,
  [Integration.laravel]: LARAVEL_AGENT_CONFIG,
};
