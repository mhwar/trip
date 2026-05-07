#!/bin/bash
# Build korea-trip.html from source files
cat src/p1.html src/p2.html src/p3.html src/p4.html src/p5.html src/p6.html src/p7.html > korea-trip.html
echo "✅ Built korea-trip.html ($(wc -c < korea-trip.html) bytes)"
