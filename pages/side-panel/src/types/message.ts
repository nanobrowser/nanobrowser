export const ACTOR_PROFILES = {
  user: {
    name: 'User',
    icon: 'icons/user.svg',
    // Semi-transparent Material blue per request
    iconBackground: 'rgb(59 130 246 / .5)',
  },
  system: {
    name: 'System',
    icon: 'icons/system.svg',
    iconBackground: '#2196F3',
  },
  planner: {
    name: 'Planner',
    icon: 'icons/planner.svg',
    // Semi-transparent Material blue per request
    iconBackground: 'rgb(59 130 246 / .5)',
  },
  navigator: {
    name: 'Navigator',
    icon: 'icons/navigator.svg',
    iconBackground: 'rgb(59 130 246 / .5)',
  },
  validator: {
    name: 'Validator',
    icon: 'icons/validator.svg',
    iconBackground: '#EC407A',
  },
  manager: {
    name: 'Manager',
    icon: 'icons/manager.svg',
    iconBackground: '#9C27B0',
  },
  evaluator: {
    name: 'Evaluator',
    icon: 'icons/evaluator.svg',
    iconBackground: '#795548',
  },
} as const;
