import { createTestInjector } from '../../../../../testing/injector';
import { EnvironmentInjector, Injector, runInInjectionContext } from '@angular/core';
import { Router } from '@angular/router';
import { BreakpointObserver } from '@angular/cdk/layout';
import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { NavbarComponent } from './navbar.component';
import { AuthService } from '../../../core/services/auth.service';
import { ProfileService } from '../../../core/services/profile.service';

describe('NavbarComponent', () => {
  it('uses the responsive breakpoint and keeps account navigation hidden', async () => {
    const router = { navigate: vi.fn() };
    const injector: EnvironmentInjector = createTestInjector([
      { provide: Router, useValue: router },
      { provide: BreakpointObserver, useValue: { observe: () => of({ matches: true }) } },
      { provide: AuthService, useValue: { loggedIn$: of(false), currentUser$: of(null) } },
      { provide: ProfileService, useValue: { userProfile$: of(null) } },
    ]);
    try {
      const component = runInInjectionContext(injector, () => new NavbarComponent());
      expect(await firstValueFrom(component.isHandset$)).toBe(true);
      expect(await firstValueFrom(component.userDisplay$)).toBeNull();
      expect(component.navItems.map(item => item.route)).toEqual(['/', '/about']);
      component.navigateTo('/about');
      expect(router.navigate).toHaveBeenCalledWith(['/about']);
    } finally {
      injector.destroy();
    }
  });
});
