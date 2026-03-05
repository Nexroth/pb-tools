#!/bin/bash

# PB Tools Release Builder
# Creates a zip file for GitHub releases

VERSION="v0.6.2"
OUTPUT="pb-tools-${VERSION}.zip"

echo "Building PB Tools release package..."
echo "Version: $VERSION"
echo "Output: $OUTPUT"
echo ""

# Remove existing zip if present
if [ -f "$OUTPUT" ]; then
    rm "$OUTPUT"
    echo "Removed existing zip file"
fi

# Create zip with explicit file list
echo "Creating zip file..."
zip -r "$OUTPUT" \
    index.html \
    app.js \
    styles.css \
    README.md \
    lib/ \
    assets/ \
    modules/

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Release package created successfully!"
    echo "📦 File: $OUTPUT"
    
    # Show file size
    if [[ "$OSTYPE" == "darwin"* ]]; then
        SIZE=$(du -h "$OUTPUT" | cut -f1)
    else
        SIZE=$(du -h "$OUTPUT" | cut -f1)
    fi
    echo "📊 Size: $SIZE"
else
    echo "❌ Error creating zip file"
    exit 1
fi
