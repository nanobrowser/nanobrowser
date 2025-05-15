import { Resource } from '../types.js';
import { browserState } from './shared-state.js';
import { currentStateResource } from './current-state.js';
import { currentDomResource } from './current-dom.js';

// Export the singleton browser state manager
export { browserState };

// Export the Resource interface
export { type Resource } from '../types.js';

// Export all available resources
export const allResources: Resource[] = [currentStateResource, currentDomResource];

// Utility function to update the browser state
export function updateBrowserState(state: any): void {
  browserState.updateState(state);
}
