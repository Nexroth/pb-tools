# PB Tools

**Version 0.6.2** | Security Operations Toolset | Developer: Raf

Internal web application for CSV analysis, data visualization, email templating, and security operations workflows. All processing occurs client-side for data privacy.

## Overview

PB Tools is a single-page web application providing security analysts with offline tools for common workflows. No server required—runs entirely in the browser with all data staying local.

## Modules

### CSV Workbench
Analyze large CSV and Excel exports, incident logs, and security data.

**Features:**
- CSV and XLSX import with drag-and-drop
- Advanced filtering and sorting
- Aggregation engine (COUNT, SUM, AVG, MIN, MAX)
- User-configurable note columns for workflow tracking
- Reusable presets for common analysis patterns
- Export to CSV, XLSX, or HTML with summary reports

**Use cases:**
- Calculate click rates and open rates by department
- Track remediation status across phishing campaigns
- Generate summary reports for stakeholders
- Filter and analyze large datasets (10k+ rows)

### Report Builder
Build interactive charts and multi-chart reports from CSV data.

**Features:**
- 9 chart types: bar, horizontal bar, line, pie, doughnut, radar, polar area, scatter, bubble
- Aggregations with automatic calculation labels
- Template system for reusable report layouts
- Comparison mode for dataset A/B analysis
- Export to HTML (standalone reports) or XLSX (data tables)

**Use cases:**
- Executive dashboards showing metrics across departments
- Trend analysis over time
- Outlier detection in user behavior
- Campaign performance comparisons

### Email Templater
Standardize security communications with reusable templates.

**Features:**
- Variable substitution from CSV data or manual input
- HTML table support with formatting preservation
- Quick Fill mode for single recipients
- Template library with save/load
- Direct copy to Outlook/Gmail with styling intact

**Use cases:**
- Phishing notifications to affected users
- Security awareness campaign communications
- Incident response updates
- Password reset notices

### EML Analyzer
Triage suspicious emails without opening them in your mail client.

**Features:**
- Multi-hop email path parsing (full routing history)
- SPF, DKIM, DMARC validation with color-coded results
- PhishER wrapper detection (avoids false positives)
- Link and attachment extraction
- IP address geolocation and reputation checks
- X-header and spam score analysis

**Use cases:**
- Quick phishing email triage
- Validate email authentication to spot spoofing
- Trace email routing for investigation
- Extract IOCs (links, IPs, attachments)

### Hash Generator
Generate file fingerprints for malware analysis and evidence documentation.

**Features:**
- MD5, SHA-1, SHA-256, SHA-512 hashing
- Drag-and-drop file interface
- Text input mode
- One-click hash copying
- Real-time hash generation

**Use cases:**
- Malware sample identification
- File integrity verification
- Threat intelligence lookups
- Forensic evidence documentation

### Base64 Toolkit
Decode obfuscated content commonly used in phishing attacks.

**Features:**
- Four encoding formats: Standard, URL-safe, UTF-7, UTF-8
- Text and file input
- Image preview for decoded images
- Encode and decode modes

**Use cases:**
- Decode obfuscated URLs in phishing emails
- Examine encoded PowerShell commands
- Analyze data exfiltration payloads
- Extract embedded images

### QR Analyzer
Investigate QR code-based phishing attacks (quishing).

**Features:**
- QR code scanning from uploaded images
- URL extraction and analysis
- Suspicious domain detection
- URL shortener identification
- Redirect chain analysis

**Use cases:**
- Triage quishing reports
- Extract and analyze embedded URLs
- Identify phishing domains
- Document QR-based threats

## Installation

### Requirements
- Modern web browser (Chrome, Firefox, Edge, Safari)
- JavaScript enabled
- No server or internet connection required

### Local Setup

1. Clone or download the repository
2. Open `index.html` in a web browser
3. All features work immediately—no build step required

### Server Deployment

Deploy as static files to any web server:

```bash
# Python
python -m http.server 8000

# Node.js
npx http-server
```

Access at `http://localhost:8000`

## File Structure

```
/
├── index.html              # Application shell
├── app.js                  # Core module system
├── styles.css              # Application styles
├── lib/
│   ├── papaparse.min.js   # CSV parsing
│   ├── xlsx.full.min.js   # XLSX import/export
│   └── chart.umd.js       # Chart.js for visualizations
└── [module files]
    ├── csvWorkbench.js
    ├── reportBuilder.js
    ├── emailTemplater.js
    ├── emlAnalyzer.js
    ├── hashGenerator.js
    ├── base64Toolkit.js
    ├── qranalyzer.js
    └── settings.js
```

## Data Privacy

**All processing occurs client-side** in the browser:
- No data transmitted to external servers
- File uploads remain local to your machine
- Optional localStorage for templates and presets (can be cleared anytime)
- Export backup/restore available in Settings

## Browser Compatibility

Tested on:
- Chrome 120+
- Firefox 120+
- Edge 120+
- Safari 17+

Requires JavaScript enabled.

## Key Features

### Theme System
8 built-in themes including Dark, Light, Cyberpunk, Catppuccin, and more. Fully customizable color schemes.

### Export Capabilities
- **CSV Workbench**: CSV, XLSX, HTML (light theme for printing)
- **Report Builder**: HTML (dark theme for screen/PDF), XLSX (data tables)
- **Email Templater**: Plain text, HTML, mailto links
- **Summary Reports**: Aggregated data with percentage breakdowns

### Data Persistence
- Templates (Email, Report Builder)
- User presets (CSV Workbench)
- Note configurations
- Theme preferences
- Full backup/restore in Settings

## Development

### Adding a Module

1. Create module file (e.g., `newModule.js`)
2. Register using `window.SecOpsWorkbench.registerModule()`
3. Add navigation button in `index.html`
4. Add script tag in `index.html`

Example:

```javascript
(function () {
  const meta = {
    title: "Module Name",
    subtitle: "Module description"
  };

  function init() {}
  function show() { /* render UI */ }
  function hide() { /* cleanup */ }

  window.SecOpsWorkbench.registerModule("moduleName", {
    meta, init, show, hide
  });
})();
```

### Script Load Order

**Critical**: Load `app.js` before module files.

```html
<script src="app.js"></script>
<script src="csvWorkbench.js"></script>
<!-- other modules -->
```

## Version History

**v0.6.2** (March 2026)
- Report Builder XLSX export
- X-axis label fixes (show category names)
- Aggregation labels in bold
- Enhanced About section

**v0.6.1** (March 2026)
- Chart legend fixes for all chart types
- Export modal enhancements
- Dropdown visibility improvements

**v0.6.0** (March 2026)
- Aggregation engine (SUM/AVG/MIN/MAX)
- Summary panel in drawer
- Report Builder aggregation support

**v0.2.0** (Earlier)
- Initial public release
- Core modules established

## License

Internal use only.