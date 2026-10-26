import { managedValue } from '../scripts/environment.js';

/** Server-only configuration; never import this module into the Angular application. */
export const getServerEnv = managedValue;
