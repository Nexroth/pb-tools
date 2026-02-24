# PB Tools

Internal security operations toolset for CSV processing, email analysis, and report generation. All processing occurs client-side for data privacy.

## Overview

PB Tools is a single-page web application providing security analysts with offline tools for common workflows. The application requires no server-side processing and can be run locally or deployed as static files.

## Modules

### CSV Workbench
Process and transform CSV data from PhishER campaigns and other sources.

**Features:**
- CSV and XLSX import
- Column filtering and renaming
- Value mapping for data normalization
- Group and count summaries
- Status annotations with localStorage persistence
- PhishER preset workflow
- Export to CSV or XLSX

**Use cases:**
- Clean PhishER fail export data
- Normalize SBU/department values
- Generate summaries for reporting
- Track remediation status

### Report Builder
Generate charts and HTML reports from CSV data.

**Features:**
- Bar, line, pie, and doughnut charts
- Configurable grouping and limits
- Multi-chart reports
- HTML export with embedded charts

**Use cases:**
- Campaign fail analysis
- Department-level metrics
- Executive summaries

### Email Templater
Create templated emails with variable substitution.

**Features:**
- CSV-based bulk email generation
- Quick Fill mode for single recipients
- Variable detection and input generation
- Template save/load
- mailto: integration
- Multiple export formats

**Use cases:**
- PhishER fail notifications
- Password reset notices
- Security awareness campaigns
- Incident response communications

### Hash Generator
Generate cryptographic hashes for files and text.

**Features:**
- MD5, SHA-1, SHA-256, SHA-512
- File upload and text input
- Drag-and-drop interface
- One-click copy

**Use cases:**
- File integrity verification
- Malware analysis
- Evidence documentation

### EML Analyzer
Analyze email headers offline when PhishER is unavailable.

**Features:**
- EML, MSG, and TXT file support
- Header parsing and display
- SPF, DKIM, DMARC extraction
- Routing path analysis
- Automated threat assessment
- Raw header export

**Use cases:**
- Phishing investigation
- Email authentication verification
- Routing analysis
- Training and documentation

### Settings
Configure application preferences.

**Features:**
- Theme selection
- Application information

## Installation

### Requirements
- Modern web browser (Chrome, Firefox, Edge, Safari)
- No server required for local use

### Local Setup

1. Clone or download the repository
2. Open `index.html` in a web browser
3. All features work immediately

### Server Deployment

Deploy as static files to any web server:

```bash
# Example with Python
python -m http.server 8000

# Example with Node.js
npx http-server
```

Then navigate to `http://localhost:8000`

## File Structure

```
/
├── index.html              # Application shell
├── app.js                  # Core module system
├── styles.css              # Application styles
├── lib/
│   ├── papaparse.min.js   # CSV parsing
│   ├── xlsx.full.min.js   # XLSX import/export
│   └── chart.umd.js       # Chart rendering
└── modules/
    ├── csvWorkbench.js
    ├── reportBuilder.js
    ├── emailTemplater.js
    ├── hashGenerator.js
    ├── emlAnalyzer.js
    └── settings.js
```

## Data Privacy

All processing occurs client-side in the browser. No data is transmitted to external servers. File uploads and processing remain local to the user's machine.

CSV annotations are stored in browser localStorage and persist across sessions.

## Browser Compatibility

Tested on:
- Chrome 120+
- Firefox 120+
- Edge 120+
- Safari 17+

Requires JavaScript enabled.

## Development

### Adding a Module

1. Create module file in `modules/`
2. Register module using `window.SecOpsWorkbench.registerModule()`
3. Add navigation button in `index.html`
4. Add script tag in `index.html`

Example module structure:

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

Critical: `app.js` must load before any module files.

```html
<script src="app.js"></script>
<script src="modules/csvWorkbench.js"></script>
<!-- other modules -->
```

## Known Limitations

- Report Builder chart previews render at lower resolution (exports are full quality)
- EML Analyzer handles single Received headers (multiple hops not fully parsed)
- XLSX export limited to basic formatting
- localStorage has 5-10MB limit depending on browser

## Version

Current version: 0.2.0

## License

Internal use only.
