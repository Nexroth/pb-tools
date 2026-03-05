#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Read version from package.json or default
let version = 'v0.6.2';
try {
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  version = packageJson.version || version;
} catch (e) {
  console.log('No package.json found, using default version:', version);
}

const outputFile = `pb-tools-${version}.zip`;

console.log('Building PB Tools release package...');
console.log('Version:', version);
console.log('Output:', outputFile);

// Files to explicitly include
const coreFiles = [
  'index.html',
  'app.js',
  'styles.css',
  'README.md'
];

const directories = ['lib/', 'assets/', 'modules/'];

// Build the file list
const allFiles = [...coreFiles, ...directories].join(' ');

try {
  // Remove existing zip if present
  if (fs.existsSync(outputFile)) {
    fs.unlinkSync(outputFile);
    console.log('Removed existing zip file');
  }

  // Create zip
  console.log('\nCreating zip file...');
  execSync(`zip -r ${outputFile} ${allFiles}`, { stdio: 'inherit' });
  
  console.log('\n✅ Release package created successfully!');
  console.log(`📦 File: ${outputFile}`);
  
  // Show file size
  const stats = fs.statSync(outputFile);
  const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
  console.log(`📊 Size: ${fileSizeMB} MB`);
  
} catch (error) {
  console.error('❌ Error creating zip file:', error.message);
  console.error('\nMake sure the "zip" command is available on your system.');
  console.error('On Windows, you may need to install zip or use WSL.');
  process.exit(1);
}
