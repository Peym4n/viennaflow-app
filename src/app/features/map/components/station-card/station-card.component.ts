import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { StationCard } from '../../map-presentation';

@Component({
  selector: 'app-station-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(keydown.escape)': 'dismiss($event)' },
  template: `
    <section class="custom-map-overlay" [class.selected]="card().selected"
      role="region" [attr.aria-labelledby]="'station-title-' + card().station.id">
      <header>
        <h2 [id]="'station-title-' + card().station.id">
          <button class="station-name" type="button" (click)="select.emit()"
            [attr.aria-label]="'Show details for ' + card().station.name">{{ card().station.name }}</button>
        </h2>
        @if (card().walkingMinutes !== undefined) {
          <span class="walking-time">
            <span class="material-icons" aria-hidden="true">directions_walk</span>
            <span aria-hidden="true">{{ card().walkingMinutes }}′</span>
            <span class="visually-hidden">{{ card().walkingMinutes }} {{ card().walkingMinutes === 1 ? 'minute' : 'minutes' }} walking</span>
          </span>
        }
        @if (card().selected) {
          <button class="overlay-close-button" type="button" aria-label="Close station details" (click)="close.emit()">
            <span class="material-icons" aria-hidden="true">close</span>
          </button>
        }
      </header>
      <div class="loading-line" [class.loading]="card().status === 'loading'" aria-hidden="true"></div>
      <div class="departures" [attr.aria-busy]="card().status === 'loading'">
        @for (row of card().rows; track row.key) {
          <div class="departure-line">
            <span class="line-badge" [style.background-color]="row.color" [style.color]="row.foreground">{{ row.line }}</span>
            <span class="material-icons direction-arrow" aria-hidden="true">chevron_right</span>
            <span class="direction">{{ row.towards }}</span>
            <span class="countdowns">
              @for (countdown of row.countdowns; track $index) {
                @if (!$first) { <span class="separator" aria-hidden="true">|</span> }
                <span class="countdown" [class.now]="countdown === 0">
                  <span aria-hidden="true">{{ countdown === 0 ? 'Now' : countdown + '′' }}</span>
                  <span class="visually-hidden">{{ countdown === 0 ? 'Departing now' : countdown === 1 ? '1 minute' : countdown + ' minutes' }}</span>
                </span>
              }
            </span>
          </div>
        }
      </div>
      <p class="status" role="status" aria-live="polite" aria-atomic="true">{{ statusMessage() }}</p>
    </section>
  `,
  styles: `
    :host { display: block; width: max-content; max-width: 100%; color: #212529; font: 13px/1.5 Roboto, Arial, sans-serif; }
    .custom-map-overlay { box-sizing: border-box; background: #fff; border: 1px solid #aaa; border-radius: 8px; box-shadow: 0 2px 6px #0003; padding: 6px 8px; }
    .selected { border-color: #3367a8; }
    header { display: flex; align-items: center; gap: 4px; }
    h2 { flex: 1; min-width: 0; margin: 0; font: inherit; }
    button { color: inherit; background: none; border: 0; border-radius: 4px; font: inherit; cursor: pointer; min-height: 32px; }
    button:focus-visible { outline: 3px solid #185abc; outline-offset: -2px; }
    .station-name { text-align: left; padding: 2px 4px; font-weight: 700; font-size: 14px; overflow-wrap: anywhere; width: 100%; }
    .overlay-close-button { display: grid; place-items: center; min-width: 32px; flex-shrink: 0; padding: 0; }
    .walking-time { display: flex; align-items: center; white-space: nowrap; color: #444; }
    .walking-time .material-icons { font-size: 19px; }
    .loading-line { height: 2px; background: #e0e0e0; margin: 2px 0 4px; overflow: hidden; }
    .loading { background: linear-gradient(90deg, #e0e0e0, #185abc, #e0e0e0); background-size: 200% 100%; animation: loading-sweep 1.5s linear infinite; }
    .departure-line { display: flex; align-items: center; gap: 3px; margin: 4px 0; }
    .line-badge { border-radius: 12px; min-width: 22px; padding: 1px 4px; font-weight: 700; text-align: center; }
    .direction-arrow { font-size: 16px; color: #595959; }
    .direction { flex: 1; min-width: 0; margin-inline-end: 8px; overflow-wrap: anywhere; font-weight: 700; font-size: 12px; }
    .countdowns { display: flex; align-items: center; gap: 5px; flex-shrink: 0; font-weight: 700; }
    .countdown { color: #005eb8; }
    .now { color: #17632b; }
    .separator { color: #595959; }
    .status { color: #595959; font-size: 12px; margin: 5px 0 2px; }
    .status:empty { display: none; }
    .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    @keyframes loading-sweep { to { background-position: -200% 0; } }
    @media (prefers-reduced-motion: reduce) { .loading { animation: none; } }
  `,
})
export class StationCardComponent {
  readonly card = input.required<StationCard>();
  readonly close = output<void>();
  readonly select = output<void>();
  readonly statusMessage = computed(() => {
    const { status, rows } = this.card();
    switch (status) {
      case 'loading': return 'Loading departures…';
      case 'error': return 'Departures could not be loaded. Retrying…';
      case 'stale': return 'Showing earlier departures. Retrying…';
      case 'empty': return 'No current departures.';
      default: return rows.length ? '' : 'No current departures.';
    }
  });

  dismiss(event: Event): void {
    if (!this.card().selected) return;
    event.stopPropagation();
    this.close.emit();
  }
}
