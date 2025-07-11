#!/bin/bash

echo "🔒 GitHub Publication Security Review"
echo "===================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Track issues
ISSUES=0

echo "📋 Checking repository structure..."

# Check for sensitive files
echo -n "Checking for sensitive files... "
SENSITIVE_FILES=$(find . -type f \( -name "*.env*" -o -name "*secret*" -o -name "*key*" -o -name "*token*" -o -name "*password*" \) -not -path "./node_modules/*" -not -path "./.git/*" 2>/dev/null | wc -l)
if [ "$SENSITIVE_FILES" -eq 0 ]; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗ Found $SENSITIVE_FILES sensitive files${NC}"
    ISSUES=$((ISSUES + 1))
fi

# Check for build artifacts
echo -n "Checking for build artifacts... "
BUILD_ARTIFACTS=$(find . -type f \( -name "*.tsbuildinfo" -o -name "*.log" \) -not -path "./node_modules/*" -not -path "./.git/*" 2>/dev/null | wc -l)
if [ "$BUILD_ARTIFACTS" -eq 0 ]; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗ Found $BUILD_ARTIFACTS build artifacts${NC}"
    ISSUES=$((ISSUES + 1))
fi

# Check .gitignore
echo -n "Checking .gitignore exists... "
if [ -f ".gitignore" ]; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗ Missing .gitignore${NC}"
    ISSUES=$((ISSUES + 1))
fi

# Check for large files
echo -n "Checking for large files (>10MB)... "
LARGE_FILES=$(find . -type f -size +10M -not -path "./node_modules/*" -not -path "./.git/*" 2>/dev/null | wc -l)
if [ "$LARGE_FILES" -eq 0 ]; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${YELLOW}⚠ Found $LARGE_FILES large files${NC}"
fi

# Check for author information
echo -n "Checking author information... "
if grep -q "sam@rizome.dev" package.json; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${YELLOW}⚠ Missing author information${NC}"
fi

# Check licenses
echo -n "Checking license files... "
if [ -f "LICENSE" ] && [ -f "LICENSE-MIT" ] && [ -f "LICENSE-APACHE" ]; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗ Missing license files${NC}"
    ISSUES=$((ISSUES + 1))
fi

# Check README
echo -n "Checking README.md... "
if [ -f "README.md" ]; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗ Missing README.md${NC}"
    ISSUES=$((ISSUES + 1))
fi

echo ""
echo "📊 Summary:"
echo "==========="

if [ "$ISSUES" -eq 0 ]; then
    echo -e "${GREEN}✅ Repository is ready for GitHub publication!${NC}"
    echo ""
    echo "Recommendations before pushing:"
    echo "1. Review commit history: git log --oneline"
    echo "2. Ensure no force pushes contain sensitive data"
    echo "3. Consider squashing commits if needed"
    echo "4. Set up branch protection rules after first push"
    echo "5. Enable GitHub security features (Dependabot, code scanning)"
else
    echo -e "${RED}❌ Found $ISSUES issues that should be fixed${NC}"
    echo ""
    echo "Fix these issues before publishing to GitHub"
fi

echo ""
echo "🔍 Additional manual checks recommended:"
echo "- Review all documentation for internal references"
echo "- Ensure all URLs point to public resources"
echo "- Verify package.json repository URLs are correct"
echo "- Check that all code is properly licensed"