# Front Attachment Viewer

A Chrome extension that enhances the attachment viewing experience on Front.com with advanced features like zoom, search, keyboard navigation, and more.

## Features

### 📄 Enhanced PDF Viewing
- **High-quality PDF rendering** using PDF.js
- **Text selection and copying** from PDF documents
- **Full-text search** within PDFs with highlighting
- **Navigate between search results** with keyboard shortcuts

### 🔍 Zoom Controls
- Zoom in/out on PDFs and images (25% to 225%)
- Keyboard shortcuts: `Ctrl/Cmd + +` to zoom in, `Ctrl/Cmd + -` to zoom out, `Ctrl/Cmd + 0` to reset
- Scroll wheel zoom with `Ctrl/Cmd` held

### ⌨️ Keyboard Navigation
- **Arrow keys** - Navigate between attachments (Left/Right)
- **Escape** - Close viewer
- **Ctrl/Cmd + F** - Open search (PDF only)
- **Enter** - Next search result
- **Shift + Enter** - Previous search result

### 👆 Swipe Gestures
- Swipe left/right on touchscreens to navigate between attachments
- Works with touchpads and touchscreen devices

### 🚀 Performance Optimizations
- **Smart preloading** - Automatically preloads adjacent attachments for instant navigation
- **Efficient caching** - Reduces redundant network requests
- **Optimized PDF rendering** - High-quality rendering with minimal performance impact
- **Lazy loading** - Only renders visible content

### 🎨 Modern UI
- Clean, professional interface matching Front's design language
- Dark mode support (automatically follows system preference)
- Responsive design for different screen sizes
- Side navigation arrows for quick access

### 📥 Download Support
- One-click download button for any attachment
- Preserves original filenames

## Installation

### Manual Installation (Developer Mode)

1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer mode** (toggle in top right corner)
4. Click **Load unpacked**
5. Select the extension directory
6. Navigate to `frontapp.com` and the extension will automatically activate

## Usage

1. Navigate to any conversation on Front.com
2. Click on any attachment thumbnail
3. The enhanced viewer will open with full features enabled
4. Use navigation arrows, keyboard shortcuts, or swipe gestures to browse attachments
5. For PDFs, use the search button (🔍) to search within the document

## Supported File Types

- **PDFs** - Full support with text selection and search
- **Images** - JPEG, PNG, GIF, WebP

## Permissions

This extension requires the following permissions:

- `activeTab` - To interact with Front.com tabs
- `scripting` - To inject the viewer functionality
- `host_permissions` for `https://*.frontapp.com/*` - To run only on Front.com

## Privacy

- This extension runs entirely locally in your browser
- No data is collected or transmitted to external servers
- No analytics or tracking
- All attachment processing happens in your browser

## Technical Details

- **Manifest Version**: 3
- **PDF Rendering**: PDF.js v3.11.174
- **Framework**: Vanilla JavaScript (no dependencies)
- **Size**: ~1.5MB (mostly PDF.js library)

## Development

### Project Structure
```
front-attachment-viewer/
├── manifest.json           # Extension configuration
├── content-script.js       # Main viewer logic
├── viewer.css             # Styles for the viewer
├── popup.html             # Extension popup UI
├── popup.js               # Popup functionality
├── icons/                 # Extension icons
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── libs/
    └── pdfjs/             # PDF.js library
        ├── pdf.min.js
        └── pdf.worker.min.js
```

### Building from Source
No build process required - this is a pure JavaScript extension. Simply load the directory as an unpacked extension in Chrome.

## Known Limitations

- Only works on Front.com (by design)
- Some specialized PDF features (forms, annotations) may not be fully supported
- Requires active internet connection to access Front.com attachments

## Troubleshooting

**Extension not working after update?**
- Refresh the Front.com page
- If that doesn't work, the extension may have been reloaded. Look for a notification at the top of the page prompting you to refresh.

**Attachments not loading?**
- Check your internet connection
- Verify you're logged into Front.com
- Try refreshing the page
- Check the browser console for errors (F12)

**PDF search not working?**
- Ensure the file is actually a PDF (not a scanned image PDF)
- Some PDFs without text layers cannot be searched

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - see [LICENSE](LICENSE) file for details

## Disclaimer

This is an **unofficial** extension and is not affiliated with, endorsed by, or connected to Front App, Inc. All Front branding and trademarks belong to Front App, Inc.

## Credits

- PDF rendering powered by [PDF.js](https://mozilla.github.io/pdf.js/)
- Design inspired by Front's UI

## Version History

### v1.4.0 (Current)
- Enhanced PDF rendering quality
- Improved search functionality
- Better performance and caching
- Dark mode support
- Touch gesture support
- Bug fixes and stability improvements

---

**Note**: This extension enhances Front.com's attachment viewing experience but does not modify or interfere with Front's core functionality.
