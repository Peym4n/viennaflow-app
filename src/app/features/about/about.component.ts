import { Component, OnInit } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

@Component({
  selector: 'app-about',
  standalone: true, // Explicitly ensure it's standalone
  imports: [], // No specific component/directive/pipe imports needed for this feature
  templateUrl: './about.component.html',
  styleUrls: ['./about.component.css'] // Corrected to styleUrls
})
export class AboutComponent implements OnInit {
  private readonly aboutUrl = 'https://viennaflow.at/about-embed?lang=en';
  sanitizedAboutUrl!: SafeResourceUrl;

  constructor(private sanitizer: DomSanitizer) {}

  ngOnInit(): void {
    this.sanitizedAboutUrl = this.sanitizer.bypassSecurityTrustResourceUrl(this.aboutUrl);
  }
}
