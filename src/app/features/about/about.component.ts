import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, signal } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

@Component({
  selector: 'app-about',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './about.component.html',
  styleUrls: ['./about.component.css']
})
export class AboutComponent implements OnInit, OnDestroy {
  readonly aboutUrl = 'https://viennaflow.at/about-embed?lang=en';
  readonly status = signal<'loading' | 'ready' | 'unavailable'>('loading');
  private deadline?: ReturnType<typeof setTimeout>;
  sanitizedAboutUrl!: SafeResourceUrl;

  constructor(private sanitizer: DomSanitizer) {}

  ngOnInit(): void {
    this.sanitizedAboutUrl = this.sanitizer.bypassSecurityTrustResourceUrl(this.aboutUrl);
    this.deadline = setTimeout(() => this.status.set('unavailable'), 12000);
  }

  loaded(): void { clearTimeout(this.deadline); this.status.set('ready'); }
  failed(): void { clearTimeout(this.deadline); this.status.set('unavailable'); }
  ngOnDestroy(): void { clearTimeout(this.deadline); }
}
