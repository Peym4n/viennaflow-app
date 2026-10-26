import { EnvironmentInjector, Injector, Provider, createEnvironmentInjector } from '@angular/core';

export function createTestInjector(providers: Provider[]): EnvironmentInjector {
  return createEnvironmentInjector(providers, Injector.NULL as EnvironmentInjector);
}
