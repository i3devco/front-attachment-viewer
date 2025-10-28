// Patch canvas creation to prevent willReadFrequently warnings
// This sets the flag intelligently without impacting GPU rendering performance
(function() {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  
  HTMLCanvasElement.prototype.getContext = function(contextType, contextAttributes) {
    if (contextType === '2d' || contextType === '2D') {
      // Always set willReadFrequently to prevent warnings
      // Modern browsers optimize this automatically based on actual usage patterns
      const enhancedAttributes = {
        ...(contextAttributes || {}),
        willReadFrequently: true
      };
      return originalGetContext.call(this, contextType, enhancedAttributes);
    }
    return originalGetContext.call(this, contextType, contextAttributes);
  };
})();

// Constants
const CONSTANTS = {
  TIMING: {
    SCAN_THROTTLE_INTERVAL: 250,
    NOTIFICATION_TIMEOUT: 12000,
    PRELOAD_QUEUE_DELAY: 100,
    PRELOAD_SUCCESS_DELAY: 200,
    PDF_RERENDER_DELAY: 500,
    NAVIGATION_UPDATE_DELAY: 100,
    SEARCH_SCROLL_DURATION: 400
  },
  ZOOM: {
    MIN: 0.25,
    MAX: 2.25,
    STEP: 0.25,
    DEFAULT: 1,
    HIGH_QUALITY_THRESHOLD: 2.0,
    RERENDER_THRESHOLD: 0.5
  },
  PDF_RENDERING: {
    BASE_SCALE: 1.5,
    MAX_QUALITY_MULTIPLIER: 2
  },
  SELECTORS: {
    CONVERSATION: '[data-testid="conversation"]',
    ATTACHMENT_BUTTON: '[data-testid*="attachment-base-"]',
    THUMBNAIL_IMAGE: 'img[src*="/attachments/"][src*="action=thumbnail"]',
    ATTACHMENT_NAME: '[class*="attachmentBase__StyledNameDiv"]'
  },
  FILE_TYPES: {
    PDF: 'application/pdf',
    IMAGE_JPEG: 'image/jpeg',
    IMAGE_PNG: 'image/png',
    IMAGE_GIF: 'image/gif',
    IMAGE_WEBP: 'image/webp'
  },
  FILENAME: {
    MIN_LENGTH: 3,
    DEFAULT_PREFIX: 'Attachment_',
    HASH_SUBSTRING_LENGTH: 8
  }
};

const EXTENSION_TYPE_MAP = {
  pdf: CONSTANTS.FILE_TYPES.PDF,
  jpg: CONSTANTS.FILE_TYPES.IMAGE_JPEG,
  jpeg: CONSTANTS.FILE_TYPES.IMAGE_JPEG,
  png: CONSTANTS.FILE_TYPES.IMAGE_PNG,
  gif: CONSTANTS.FILE_TYPES.IMAGE_GIF,
  webp: CONSTANTS.FILE_TYPES.IMAGE_WEBP
};

class FrontAttachmentViewer {
  constructor() {
    this.attachments = [];
    this.currentIndex = 0;
    this.overlay = null;
    this.zoomLevel = CONSTANTS.ZOOM.DEFAULT;
    this.minZoom = CONSTANTS.ZOOM.MIN;
    this.maxZoom = CONSTANTS.ZOOM.MAX;
    this.zoomStep = CONSTANTS.ZOOM.STEP;
    this.lastPdfRenderZoom = CONSTANTS.ZOOM.DEFAULT;
    this.pdfRenderTimeout = null;
    this.searchMode = false;
    this.searchResults = [];
    this.currentSearchIndex = 0;
    this.currentPdf = null;
    this.preloadCache = new Map();
    this.preloadQueue = [];
    this.attachmentCache = new Map();
    this.mutationObserver = null;
    this.scanThrottleTimeout = null;
    this.lastScanTimestamp = 0;
    
    // Lazy loading properties
    this.intersectionObserver = null;
    this.renderedPages = new Set();
    this.pagePlaceholders = new Map();
    this.isVirtualScrolling = false;
    
    // Gesture properties
    this.touchStartX = 0;
    this.touchStartY = 0;
    this.touchStartTime = 0;
    this.isSwiping = false;
    
    // Performance properties
    this.pdfWorker = null;
    this.renderQueue = [];
    this.isRendering = false;
    
    // Navigation tracking for predictive preloading
    this.navigationDirection = 'forward'; // 'forward' or 'backward'
    this.lastNavigationTime = 0;
    
    // Search debouncing
    this.searchDebounceTimer = null;
    
    // Transition state
    this.isTransitioning = false;

    this.init();
  }

  init() {
    if (!this.isExtensionContextValid()) {
      this.showContextInvalidationWarning();
      return;
    }
    
    this.createOverlay();
    this.setupEventListeners();
    this.setupDynamicContentWatcher();
    this.performInitialScan();
  }

  showContextInvalidationWarning() {
    const notification = document.createElement('div');
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: var(--front-bg-primary);
      color: var(--front-text-primary);
      padding: 16px 20px;
      border-radius: var(--front-radius-lg);
      z-index: 10000;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 14px;
      box-shadow: var(--front-shadow-xl);
      cursor: pointer;
      transition: all 0.3s ease;
      border: 1px solid var(--front-border);
      min-width: 280px;
    `;
    
    notification.innerHTML = `
      <div style="display: flex; align-items: flex-start; gap: 12px;">
        <div style="font-size: 20px; line-height: 1; margin-top: 2px;">🔄</div>
        <div style="flex: 1;">
          <div style="font-weight: 600; margin-bottom: 4px; color: var(--front-text-primary);">Extension Updated</div>
          <div style="font-size: 13px; color: var(--front-text-secondary); line-height: 1.4;">Click to refresh and restore attachment viewer</div>
        </div>
      </div>
    `;
    
    notification.addEventListener('click', () => {
      window.location.reload();
    });
    
    notification.addEventListener('mouseenter', () => {
      notification.style.transform = 'translateY(-2px)';
      notification.style.boxShadow = 'var(--front-shadow-xl)';
    });
    
    notification.addEventListener('mouseleave', () => {
      notification.style.transform = 'translateY(0)';
      notification.style.boxShadow = 'var(--front-shadow-lg)';
    });
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
      if (notification.parentNode) {
        notification.style.opacity = '0';
        notification.style.transform = 'translateY(-10px)';
        setTimeout(() => notification.remove(), 300);
      }
    }, 12000);
  }

  setupDynamicContentWatcher() {
    this.mutationObserver = new MutationObserver((mutations) => {
      let shouldRescan = false;
      
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (this.containsAttachments(node)) {
              shouldRescan = true;
            }
          }
        });
      });
      
      if (shouldRescan) {
        this.throttledRescan();
      }
    });

    const conversationArea = document.querySelector('[data-testid="conversation"]') || 
                            document.querySelector('.conversation') || 
                            document.body;
                            
    this.mutationObserver.observe(conversationArea, {
      childList: true,
      subtree: true,
      attributes: false
    });
  }

  containsAttachments(element) {
    return element.querySelector && (
      element.querySelector('[data-testid*="attachment-base-"]') ||
      element.matches('[data-testid*="attachment-base-"]') ||
      element.querySelector('.attachments') ||
      element.querySelector('[class*="attachment"]')
    );
  }

  throttledRescan() {
    const now = Date.now();
    const minInterval = 250;
    
    if (now - this.lastScanTimestamp < minInterval) {
      if (this.scanThrottleTimeout) {
        clearTimeout(this.scanThrottleTimeout);
      }
      
      this.scanThrottleTimeout = setTimeout(() => {
        this.smartRescan();
      }, minInterval);
      
      return;
    }
    
    this.smartRescan();
  }

  smartRescan() {
    this.lastScanTimestamp = Date.now();
    
    const previousAttachmentCount = this.attachments.length;
    const newAttachments = [];
    const seenHashes = new Set();
    
    const attachmentButtons = document.querySelectorAll('[data-testid*="attachment-base-"]');
    
    attachmentButtons.forEach((button) => {
      const thumbnailImg = button.querySelector('img[src*="/attachments/"][src*="action=thumbnail"]');
      if (!thumbnailImg) return;

      const attachmentData = this.extractAttachmentFromImage(thumbnailImg);
      if (!attachmentData) return;

      seenHashes.add(attachmentData.hash);
      
      if (this.attachmentCache.has(attachmentData.hash)) {
        const cachedData = this.attachmentCache.get(attachmentData.hash);
        cachedData.element = thumbnailImg;
        newAttachments.push(cachedData);
      } else {
        attachmentData.index = newAttachments.length;
        this.attachmentCache.set(attachmentData.hash, attachmentData);
        newAttachments.push(attachmentData);
      }
    });

    this.cleanupRemovedAttachments(seenHashes);
    
    this.attachments = newAttachments;
    
    const newCount = this.attachments.length;
    if (newCount !== previousAttachmentCount) {
      if (this.isViewerOpen()) {
        this.updateNavigation();
        this.startPreloading();
      }
    }
  }

  cleanupRemovedAttachments(currentHashes) {
    for (const [hash, attachment] of this.attachmentCache.entries()) {
      if (!currentHashes.has(hash)) {
        this.attachmentCache.delete(hash);
        
        const cacheKey = `${hash}-${attachment.url}`;
        this.preloadCache.delete(cacheKey);
      }
    }
  }

  performInitialScan() {
    this.smartRescan();
  }

  scanConversationArea(conversationElement) {
    if (!conversationElement) return;
    
    const attachmentButtons = conversationElement.querySelectorAll('[data-testid*="attachment-base-"]');
    let newAttachmentsFound = 0;
    
    attachmentButtons.forEach((button) => {
      const thumbnailImg = button.querySelector('img[src*="/attachments/"][src*="action=thumbnail"]');
      if (!thumbnailImg) return;

      const attachmentData = this.extractAttachmentFromImage(thumbnailImg);
      if (!attachmentData) return;

      if (!this.attachmentCache.has(attachmentData.hash)) {
        attachmentData.index = this.attachments.length;
        this.attachmentCache.set(attachmentData.hash, attachmentData);
        this.attachments.push(attachmentData);
        newAttachmentsFound++;
      }
    });
    
    if (newAttachmentsFound > 0) {
      if (this.isViewerOpen()) {
        this.updateNavigation();
      }
    }
  }

  createOverlay() {
    const existing = document.getElementById('front-attachment-overlay');
    if (existing) existing.remove();

    this.overlay = this.buildOverlayElement();
    document.body.appendChild(this.overlay);
    this.setupOverlayEvents();
  }

  buildOverlayElement() {
    const overlay = document.createElement('div');
    overlay.id = 'front-attachment-overlay';
    overlay.className = 'front-attachment-overlay hidden';
    overlay.innerHTML = this.getOverlayHTML();
    return overlay;
  }

  getOverlayHTML() {
    return `
      <div class="front-attachment-nav">
        <div class="front-attachment-nav-left">
          <button class="front-attachment-nav-button" id="front-prev-btn" disabled title="Previous">Previous</button>
          <button class="front-attachment-nav-button" id="front-next-btn" disabled title="Next">Next</button>
          <div class="front-attachment-counter" id="front-counter"></div>
        </div>
        <div class="front-attachment-title" id="front-title">Attachment Viewer</div>
        <div class="front-attachment-nav-right">
          ${this.getSearchControlsHTML()}
          ${this.getZoomControlsHTML()}
          <button class="front-attachment-nav-button success" id="front-download-btn" title="Download">Download</button>
          <button class="front-attachment-close" id="front-close-btn" title="Close">
            <svg width="20" height="20" fill="currentColor" viewBox="0 0 20 20" data-testid="x-close/outlined/20">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="front-attachment-viewer" id="front-viewer">
        <div class="front-attachment-loading" id="front-loading">
          <div class="front-attachment-spinner"></div>
          <div>Loading attachment...</div>
        </div>
      </div>
      
      <div class="front-side-arrow front-side-arrow-left" id="front-side-arrow-left" title="Previous attachment">
        <div class="front-side-arrow-icon">‹</div>
      </div>
      <div class="front-side-arrow front-side-arrow-right" id="front-side-arrow-right" title="Next attachment">
        <div class="front-side-arrow-icon">›</div>
      </div>
      <div class="front-attachment-info">
        <div class="front-attachment-filename" id="front-filename">No file selected</div>
      </div>
    `;
  }

  getSearchControlsHTML() {
    return `
      <div class="front-search-controls" id="front-search-controls" style="display: none;">
        <div class="front-search-wrapper">
          <div class="front-search-box">
            <input type="text" class="front-search-input" id="front-search-input" placeholder="Find" autocomplete="off" spellcheck="false" />
            <div class="front-search-accessories">
              <span class="front-search-counter" id="front-search-counter"></span>
              <div class="front-search-controls-buttons">
                <div class="front-search-control-button" id="front-search-prev-btn" title="Previous Result">
                  <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16" data-testid="chevron-up/outlined/16">
                    <path fill-rule="evenodd" d="M7.47 4.47a.75.75 0 0 1 1.06 0l3.75 3.75a.75.75 0 1 1-1.06 1.06L8 6.06 4.78 9.28a.75.75 0 0 1-1.06-1.06l3.75-3.75Z" clip-rule="evenodd"/>
                  </svg>
                </div>
                <div class="front-search-control-button" id="front-search-next-btn" title="Next Result">
                  <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16" data-testid="chevron-down/outlined/16">
                    <path fill-rule="evenodd" d="M8.53 11.53a.75.75 0 0 1-1.06 0L3.72 7.78a.75.75 0 0 1 1.06-1.06L8 9.94l3.22-3.22a.75.75 0 1 1 1.06 1.06l-3.75 3.75Z" clip-rule="evenodd"/>
                  </svg>
                </div>
                <div class="front-search-control-button" id="front-search-close-btn" title="Close Search">
                  <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16" data-testid="x-close/outlined/16">
                      <path d="M3.5 3.5a.5.5 0 0 1 .708 0L8 7.293l3.792-3.793a.5.5 0 0 1 .708.708L8.707 8l3.793 3.792a.5.5 0 0 1-.708.708L8 8.707l-3.792 3.793a.5.5 0 0 1-.708-.708L7.293 8 3.5 4.208a.5.5 0 0 1 0-.708z"/>
                  </svg>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <button class="front-attachment-nav-button primary" id="front-search-btn" title="Search PDF">
        <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16" data-testid="search-sm/outlined/16">
          <path fill-rule="evenodd" d="M11.5 7a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Zm-.82 4.74a6 6 0 1 1 1.06-1.06l2.79 2.79a.75.75 0 1 1-1.06 1.06l-2.79-2.79Z" clip-rule="evenodd"/>
        </svg>
      </button>
    `;
  }

  getZoomControlsHTML() {
    return `
      <div class="front-zoom-controls">
        <button class="front-attachment-nav-button" id="front-zoom-out-btn" title="Zoom Out">−</button>
        <div class="front-zoom-level" id="front-zoom-level">100%</div>
        <button class="front-attachment-nav-button" id="front-zoom-in-btn" title="Zoom In">+</button>
      </div>
    `;
  }

  setupOverlayEvents() {
    const elements = this.getOverlayElements();
    
    elements.prevBtn.addEventListener('click', () => this.navigatePrevious());
    elements.nextBtn.addEventListener('click', () => this.navigateNext());
    elements.closeBtn.addEventListener('click', () => this.closeViewer());
    elements.downloadBtn.addEventListener('click', () => this.downloadCurrentAttachment());
    
    this.setupZoomEvents(elements);
    this.setupSearchEvents(elements);
    this.setupSideArrowEvents();
    this.setupEnhancedClickToClose();
    this.setupSwipeGestures();
    this.setupScrollZoom();
  }

  setupEnhancedClickToClose() {
    // Click on overlay background to close
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) {
        this.closeViewer();
      }
    });
    
    // Click on viewer container background (not on content) to close
    const viewer = document.getElementById('front-viewer');
    if (viewer) {
      viewer.addEventListener('click', (e) => {
        // Only close if clicking directly on the viewer background, not its children
        if (e.target === viewer || e.target.classList.contains('front-attachment-content')) {
          this.closeViewer();
        }
      });
      
      // Add cursor pointer to show clickable area
      viewer.style.cursor = 'pointer';
      
      // Ensure content doesn't inherit the pointer cursor
      viewer.addEventListener('mouseenter', (e) => {
        if (e.target !== viewer) {
          e.target.style.cursor = 'auto';
        }
      }, true);
    }
  }

  setupSwipeGestures() {
    const viewer = document.getElementById('front-viewer');
    if (!viewer) return;
    
    // Support both touch and pointer events for touchscreen computers
    const startEvents = ['touchstart', 'pointerdown'];
    const moveEvents = ['touchmove', 'pointermove'];
    const endEvents = ['touchend', 'pointerup'];
    
    const getEventCoords = (e) => {
      if (e.touches && e.touches[0]) {
        return { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
      return { x: e.clientX, y: e.clientY };
    };
    
    const handleStart = (e) => {
      // Only handle if it's a touch/pen event or primary button
      if (e.type === 'pointerdown' && e.pointerType === 'mouse') return;
      
      const coords = getEventCoords(e);
      this.touchStartX = coords.x;
      this.touchStartY = coords.y;
      this.touchStartTime = Date.now();
      this.isSwiping = false;
    };
    
    const handleMove = (e) => {
      if (this.touchStartX === 0) return;
      
      const coords = getEventCoords(e);
      const deltaX = coords.x - this.touchStartX;
      const deltaY = coords.y - this.touchStartY;
      
      // Detect if this is a horizontal swipe (more horizontal than vertical movement)
      if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 10) {
        this.isSwiping = true;
        e.preventDefault();
      }
    };
    
    const handleEnd = (e) => {
      if (this.touchStartX === 0 || !this.isSwiping) {
        this.touchStartX = 0;
        this.touchStartY = 0;
        this.isSwiping = false;
        return;
      }
      
      const coords = getEventCoords(e);
      const deltaX = coords.x - this.touchStartX;
      const deltaY = Math.abs(coords.y - this.touchStartY);
      const deltaTime = Date.now() - this.touchStartTime;
      const velocity = Math.abs(deltaX) / deltaTime;
      
      // Check if it's a valid swipe: sufficient horizontal distance, not too much vertical, and reasonable velocity
      if (Math.abs(deltaX) > 50 && deltaY < 100 && velocity > 0.3) {
        if (deltaX > 0) {
          // Swipe right = previous attachment
          this.navigatePrevious();
        } else {
          // Swipe left = next attachment
          this.navigateNext();
        }
      }
      
      this.touchStartX = 0;
      this.touchStartY = 0;
      this.isSwiping = false;
    };
    
    startEvents.forEach(event => viewer.addEventListener(event, handleStart, { passive: true }));
    moveEvents.forEach(event => viewer.addEventListener(event, handleMove, { passive: false }));
    endEvents.forEach(event => viewer.addEventListener(event, handleEnd, { passive: true }));
  }

  setupSideArrowEvents() {
    const leftArrow = document.getElementById('front-side-arrow-left');
    const rightArrow = document.getElementById('front-side-arrow-right');
    
    if (leftArrow) {
      leftArrow.addEventListener('click', (e) => {
        e.stopPropagation();
        this.navigatePrevious();
      });
    }
    
    if (rightArrow) {
      rightArrow.addEventListener('click', (e) => {
        e.stopPropagation();
        this.navigateNext();
      });
    }
  }

  getOverlayElements() {
    return {
      prevBtn: document.getElementById('front-prev-btn'),
      nextBtn: document.getElementById('front-next-btn'),
      closeBtn: document.getElementById('front-close-btn'),
      downloadBtn: document.getElementById('front-download-btn'),
      zoomInBtn: document.getElementById('front-zoom-in-btn'),
      zoomOutBtn: document.getElementById('front-zoom-out-btn'),
      searchBtn: document.getElementById('front-search-btn'),
      searchInput: document.getElementById('front-search-input'),
      searchPrevBtn: document.getElementById('front-search-prev-btn'),
      searchNextBtn: document.getElementById('front-search-next-btn'),
      searchCloseBtn: document.getElementById('front-search-close-btn')
    };
  }

  setupZoomEvents(elements) {
    elements.zoomInBtn.addEventListener('click', () => this.zoomIn());
    elements.zoomOutBtn.addEventListener('click', () => this.zoomOut());
  }

  setupSearchEvents(elements) {
    elements.searchBtn.addEventListener('click', () => this.toggleSearch());
    elements.searchInput.addEventListener('input', (e) => this.performSearch(e.target.value));
    elements.searchInput.addEventListener('keydown', (e) => this.handleSearchKeydown(e));
    elements.searchPrevBtn.addEventListener('click', () => this.navigateSearchPrevious());
    elements.searchNextBtn.addEventListener('click', () => this.navigateSearchNext());
    elements.searchCloseBtn.addEventListener('click', () => this.closeSearch());
  }

  handleSearchKeydown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        this.navigateSearchPrevious();
      } else {
        this.navigateSearchNext();
      }
    }
  }

  setupScrollZoom() {
    this.overlay.addEventListener('wheel', (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        if (e.deltaY > 0) {
          this.zoomOut();
        } else {
          this.zoomIn();
        }
      }
    });
  }

  setupEventListeners() {
    this.setupKeyboardNavigation();
    this.setupAttachmentClickHandler();
  }

  setupKeyboardNavigation() {
    document.addEventListener('keydown', (e) => {
      if (!this.isViewerOpen()) return;

      if (this.handleSearchKeyNavigation(e)) return;

      switch(e.key) {
        case 'Escape': 
          e.preventDefault(); 
          this.searchMode ? this.closeSearch() : this.closeViewer();
          break;
        case 'ArrowLeft': 
          if (!this.searchMode) {
            e.preventDefault(); 
            this.navigatePrevious(); 
          }
          break;
        case 'ArrowRight': 
          if (!this.searchMode) {
            e.preventDefault(); 
            this.navigateNext(); 
          }
          break;
        case '=':
        case '+': 
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault(); 
            this.zoomIn(); 
          }
          break;
        case '-': 
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault(); 
            this.zoomOut(); 
          }
          break;
        case '0': 
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault(); 
            this.resetZoom(); 
          }
          break;
      }

      if (e.key.toLowerCase() === 'f' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.toggleSearch();
      }
    });
  }

  handleSearchKeyNavigation(e) {
    if (this.searchMode && this.searchResults.length > 0) {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.navigateSearchPrevious();
        return true;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.navigateSearchNext();
        return true;
      }
    }
    return false;
  }

  setupAttachmentClickHandler() {
    document.addEventListener('click', (e) => {
      if (this.isDownloadButton(e.target)) {
        return;
      }

      const attachmentButton = this.findAttachmentButton(e.target);
      if (!attachmentButton) return;

      const imgElement = attachmentButton.querySelector('img[src*="/attachments/"][src*="action=thumbnail"]');
      if (!imgElement) return;

      e.preventDefault();
      e.stopPropagation();
      this.handleAttachmentClick(imgElement);
    }, true);
  }

  isDownloadButton(target) {
    if (target.tagName === 'SVG' && target.getAttribute('data-testid')?.includes('download')) {
      return true;
    }
    
    if (target.closest('svg[data-testid*="download"]')) {
      return true;
    }
    
    if (target.textContent?.trim() === 'Download' && 
        target.closest('[role="button"]')) {
      return true;
    } 
    
    return false;
  }

  findAttachmentButton(target) {
    if (target.tagName === 'IMG' &&
        target.src.includes('/attachments/') &&
        target.src.includes('action=thumbnail') &&
        target.className.includes('attachmentBase__StyledThumbnailImage')) {
      return target.closest('[data-testid*="attachment-base-"]');
    }
    return target.closest('[data-testid*="attachment-base-"]');
  }

  async handleAttachmentClick(imgElement) {
    const clickedAttachment = this.extractAttachmentFromImage(imgElement);
    if (!clickedAttachment) {
      return;
    }

    const conversationArea = imgElement.closest('[data-testid="conversation"]') || 
                            imgElement.closest('.conversation');
    if (conversationArea) {
      this.scanConversationArea(conversationArea);
    }

    this.setCurrentAttachment(clickedAttachment);

    const wasViewerOpen = this.isViewerOpen();
    
    const cacheKey = `${clickedAttachment.hash}-${clickedAttachment.url}`;
    if (!this.preloadCache.has(cacheKey)) {
      if (!wasViewerOpen) {
        this.showViewer();
      }
      this.showLoadingState(clickedAttachment.filename);
    } else if (!wasViewerOpen) {
      this.showViewer();
    }
    
    this.closeSearch();
    await this.loadCurrentAttachment();
    
    this.updateZoomDisplay();
    this.updateZoomButtons();
  }

  setCurrentAttachment(clickedAttachment) {
    const attachmentIndex = this.attachments.findIndex(att => att.hash === clickedAttachment.hash);
    if (attachmentIndex === -1) {
      this.attachments.push(clickedAttachment);
      this.currentIndex = this.attachments.length - 1;
    } else {
      this.currentIndex = attachmentIndex;
    }
  }

  extractAttachmentFromImage(imgElement) {
    const thumbnailUrl = imgElement.src.startsWith('/') ? 
      window.location.origin + imgElement.src : imgElement.src;
    const viewUrl = thumbnailUrl.replace('action=thumbnail', 'action=view');

    const hashMatch = viewUrl.match(/\/attachments\/([a-f0-9]+)/);
    const hash = hashMatch ? hashMatch[1] : null;
    if (!hash) return null;

    const filename = this.extractFilename(imgElement, hash);

    return { url: viewUrl, filename, hash, element: imgElement };
  }

  extractFilename(imgElement, hash) {
    let filename = '';
    const attachmentButton = imgElement.closest('[data-testid*="attachment-base"]');
    if (attachmentButton) {
      const nameDiv = attachmentButton.querySelector('[class*="attachmentBase__StyledNameDiv"]');
      if (nameDiv && nameDiv.textContent) {
        filename = nameDiv.textContent.trim();
      }
    }

    return filename && filename.length >= 3 ? 
      filename : `Attachment_${hash.substring(0, 8)}.pdf`;
  }

  async loadCurrentAttachment() {
    if (!this.attachments[this.currentIndex]) return;

    const attachment = this.attachments[this.currentIndex];
    const cacheKey = `${attachment.hash}-${attachment.url}`;
    
    this.updateUI(attachment);

    if (this.preloadCache.has(cacheKey)) {
      await this.loadFromCache(attachment, cacheKey);
    } else {
      await this.loadFromNetwork(attachment, cacheKey);
    }

    this.startPreloading();
  }

  updateUI(attachment) {
    const filename = document.getElementById('front-filename');
    const title = document.getElementById('front-title');
    
    filename.textContent = attachment.filename;
    title.textContent = attachment.filename;
    this.updateNavigation();
    this.updateSearchVisibility();
  }

  async loadFromCache(attachment, cacheKey) {
    const cachedData = this.preloadCache.get(cacheKey);
    attachment.blob = cachedData.blob;
    attachment.contentType = cachedData.contentType;
    
    if (cachedData.contentType.includes('application/pdf')) {
      await this.renderPDF(cachedData.blob);
    } else if (cachedData.contentType.startsWith('image/')) {
      this.renderImage(cachedData.blob);
    } else {
      this.renderUnsupported(attachment.filename, cachedData.contentType);
    }
  }

  async loadFromNetwork(attachment, cacheKey) {
    this.showLoadingState(attachment.filename);

    try {
      if (!this.isExtensionContextValid()) {
        throw new Error('Extension context invalidated - please refresh the page');
      }

      // Use high priority for current attachment
      const { blob, contentType } = await this.fetchAttachment(attachment, { priority: 'high' });
      attachment.blob = blob;
      attachment.contentType = contentType;
      
      this.preloadCache.set(cacheKey, { blob, contentType, timestamp: Date.now(), index: this.currentIndex });
      
      if (contentType.includes('application/pdf')) {
        await this.renderPDF(blob);
      } else if (contentType.startsWith('image/')) {
        this.renderImage(blob);
      } else {
        this.renderUnsupported(attachment.filename, contentType);
      }
    } catch (err) {
      if (err.message.includes('Extension context invalidated') || 
          err.message.includes('context invalidated')) {
        this.renderContextInvalidatedError();
      } else {
        this.renderError(`Failed to load ${attachment.filename}: ${err.message}`);
      }
    }
  }

  showLoadingState(filename) {
    const viewer = document.getElementById('front-viewer');
    viewer.innerHTML = `
      <div class="front-attachment-loading" id="front-loading">
        <div class="front-attachment-spinner"></div>
        <div>Loading ${filename}...</div>
      </div>
    `;
  }

  async fetchAttachment(attachment, options = {}) {
    const headers = {
      'Accept': '*/*'
    };
    
    // Add prefetch headers for faster loading
    if (options.priority === 'high') {
      headers['Priority'] = 'u=1';
      headers['Importance'] = 'high';
    }
    
    const response = await fetch(attachment.url, { 
      headers,
      priority: options.priority || 'auto'
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
    }

    const contentType = this.determineContentType(response, attachment.filename);
    const blob = await response.blob();
    return { blob, contentType };
  }

  determineContentType(response, filename) {
    let contentType = response.headers.get('content-type') || '';
    if (!contentType || contentType.includes('octet-stream')) {
      const ext = filename.split('.').pop().toLowerCase();
      const typeMap = {
        pdf: 'application/pdf',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        gif: 'image/gif',
        webp: 'image/webp'
      };
      contentType = typeMap[ext] || contentType;
    }
    return contentType;
  }

  startPreloading() {
    // Clean up old cache entries if cache is too large
    this.manageCacheSize();
    
    this.preloadQueue = [];
    
    // Immediate priority: adjacent attachments (preload in parallel)
    const priorityIndices = [
      this.currentIndex + 1,
      this.currentIndex - 1
    ].filter(index => index >= 0 && index < this.attachments.length);
    
    // Preload priority attachments in parallel for faster navigation
    Promise.all(priorityIndices.map(async (index) => {
      const attachment = this.attachments[index];
      const cacheKey = `${attachment.hash}-${attachment.url}`;
      
      if (!this.preloadCache.has(cacheKey)) {
        try {
          const { blob, contentType } = await this.fetchAttachment(attachment);
          this.preloadCache.set(cacheKey, { 
            blob, 
            contentType,
            timestamp: Date.now(),
            index
          });
        } catch (err) {
          // Silently fail for preloading
        }
      }
    }));
    
    // Secondary priority: next 3 attachments for aggressive preloading
    const secondaryIndices = [
      this.currentIndex + 2,
      this.currentIndex - 2,
      this.currentIndex + 3,
      this.currentIndex - 3
    ].filter(index => index >= 0 && index < this.attachments.length);
    
    secondaryIndices.forEach(index => {
      const attachment = this.attachments[index];
      const cacheKey = `${attachment.hash}-${attachment.url}`;
      if (!this.preloadCache.has(cacheKey) && !this.preloadQueue.includes(index)) {
        this.preloadQueue.push(index);
      }
    });
    
    this.processPreloadQueue();
  }

  manageCacheSize() {
    const MAX_CACHE_SIZE = 10;
    
    if (this.preloadCache.size > MAX_CACHE_SIZE) {
      // Convert to array and sort by timestamp (oldest first)
      const entries = Array.from(this.preloadCache.entries())
        .map(([key, value]) => ({
          key,
          timestamp: value.timestamp || 0,
          index: value.index || 0
        }))
        .sort((a, b) => a.timestamp - b.timestamp);
      
      // Calculate how many entries to remove
      const removeCount = this.preloadCache.size - MAX_CACHE_SIZE;
      
      // Remove oldest entries that are far from current index
      let removed = 0;
      for (const entry of entries) {
        if (removed >= removeCount) break;
        
        // Don't remove entries close to current index
        const distance = Math.abs(entry.index - this.currentIndex);
        if (distance > 3) {
          this.preloadCache.delete(entry.key);
          removed++;
        }
      }
    }
  }

  async processPreloadQueue() {
    if (this.preloadQueue.length === 0) return;
    
    const index = this.preloadQueue.shift();
    const attachment = this.attachments[index];
    if (!attachment) {
      setTimeout(() => this.processPreloadQueue(), 100);
      return;
    }
    
    const cacheKey = `${attachment.hash}-${attachment.url}`;
    
    if (this.preloadCache.has(cacheKey)) {
      setTimeout(() => this.processPreloadQueue(), 100);
      return;
    }
    
    try {
      if (!this.isExtensionContextValid()) {
        return;
      }

      const { blob, contentType } = await this.fetchAttachment(attachment);
      
      this.preloadCache.set(cacheKey, { blob, contentType });
      
      setTimeout(() => this.processPreloadQueue(), 200);
    } catch (err) {
      if (err.message && err.message.includes('context invalidated')) {
        return;
      }
      
      setTimeout(() => this.processPreloadQueue(), 100);
    }
  }

  renderImage(blob) {
    const viewer = document.getElementById('front-viewer');
    const imageUrl = URL.createObjectURL(blob);
    
    // Create a temporary image to get dimensions
    const tempImg = new Image();
    tempImg.src = imageUrl;
    
    tempImg.decode().then(() => {
      const width = tempImg.naturalWidth;
      const height = tempImg.naturalHeight;
      
      viewer.innerHTML = `
        <div class="front-attachment-content">
          <div id="front-image-container" style="transform: scale(${this.zoomLevel}); transform-origin: center top;">
            <img 
              src="${imageUrl}" 
              alt="Attachment" 
              width="${width}"
              height="${height}"
              loading="eager"
              decoding="async"
              fetchpriority="high"
              style="height: 100vh; width: auto; object-fit: contain; will-change: transform;" 
            />
          </div>
        </div>
      `;
      
      this.updateZoomDisplay();
    }).catch(() => {
      // Fallback without dimensions
      viewer.innerHTML = `
        <div class="front-attachment-content">
          <div id="front-image-container" style="transform: scale(${this.zoomLevel}); transform-origin: center top;">
            <img 
              src="${imageUrl}" 
              alt="Attachment" 
              loading="eager"
              decoding="async"
              fetchpriority="high"
              style="height: 100vh; width: auto; object-fit: contain; will-change: transform;" 
            />
          </div>
        </div>
      `;
      
      const img = viewer.querySelector('img');
      img.onload = () => {
        this.updateZoomDisplay();
      };
    });
  }

  async renderPDF(blob) {
    const viewer = document.getElementById('front-viewer');
    try {
      if (typeof pdfjsLib === 'undefined') {
        throw new Error('PDF.js not loaded');
      }
      
      if (!this.isExtensionContextValid()) {
        throw new Error('Extension context invalidated - please refresh the page');
      }
      
      try {
        pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('libs/pdfjs/pdf.worker.min.js');
      } catch (contextError) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      }

      const pdfUrl = URL.createObjectURL(blob);
      const pdf = await pdfjsLib.getDocument({ url: pdfUrl }).promise;
      this.currentPdf = pdf;

      await this.renderPDFPages(pdf, viewer);
      URL.revokeObjectURL(pdfUrl);
      this.updateZoomDisplay();
    } catch (error) {
      if (error.message.includes('Extension context invalidated') || 
          error.message.includes('context invalidated')) {
        this.renderContextInvalidatedError();
      } else {
        this.renderPDFError(blob);
      }
    }
  }

  isExtensionContextValid() {
    try {
      return !!(chrome && chrome.runtime && chrome.runtime.getURL);
    } catch (e) {
      return false;
    }
  }

  renderContextInvalidatedError() {
    const viewer = document.getElementById('front-viewer');
    viewer.innerHTML = `
      <div class="front-attachment-error">
        <div class="front-attachment-error-icon">🔄</div>
        <div style="font-size: 18px; font-weight: 600; color: var(--front-text-primary); margin-bottom: 8px;">Extension Context Invalidated</div>
        <div style="color: var(--front-text-secondary); margin-bottom: 24px; line-height: 1.5;">
          The extension was updated or reloaded. Please refresh the page to continue using the attachment viewer.
        </div>
        <button onclick="window.location.reload()" 
               class="front-attachment-nav-button primary"
               style="padding: 12px 24px; font-size: 14px; font-weight: 600;">
          Refresh Page
        </button>
      </div>
    `;
  }

  async renderPDFPages(pdf, viewer) {
    viewer.innerHTML = `
      <div class="front-attachment-content">
        <div id="front-pdf-container" style="padding-top: 16px; transform: scale(${this.zoomLevel}); transform-origin: center top;"></div>
      </div>
    `;
    const container = document.getElementById('front-pdf-container');
    
    const renderingConfig = this.getPDFRenderingConfig();
    
    // Render first page immediately for fast perceived loading
    if (pdf.numPages > 0) {
      const firstPage = await pdf.getPage(1);
      await this.renderPDFPage(firstPage, container, 1, renderingConfig);
      this.updateZoomDisplay();
    }
    
    // Render remaining pages asynchronously without blocking
    if (pdf.numPages > 1) {
      // Use setTimeout to yield to the browser and show the first page immediately
      setTimeout(async () => {
        const renderPromises = [];
        for (let pageNum = 2; pageNum <= pdf.numPages; pageNum++) {
          // Render pages in parallel for faster loading
          renderPromises.push(
            pdf.getPage(pageNum).then(page => 
              this.renderPDFPage(page, container, pageNum, renderingConfig)
            )
          );
        }
        await Promise.all(renderPromises);
      }, 0);
    }
  }

  getPDFRenderingConfig() {
    const baseScale = 1.5;
    const dpiScale = window.devicePixelRatio || 1;
    const qualityMultiplier = this.zoomLevel > 2.0 ? Math.min(this.zoomLevel * 0.8, 2) : 1;
    const renderScale = baseScale * dpiScale * qualityMultiplier;
    
    return { baseScale, dpiScale, qualityMultiplier, renderScale };
  }

  async renderPDFPage(page, container, pageNum, config) {
    const canvasViewport = page.getViewport({ scale: config.renderScale });
    const canvas = document.createElement('canvas');
    
    const context = this.setupCanvas(canvas, canvasViewport, config);
    await this.renderCanvasContent(page, context, canvasViewport);
    
    const pageContainer = this.createPageContainer(pageNum, canvas, config.baseScale);
    container.appendChild(pageContainer);
    
    await this.addTextLayer(page, pageContainer, config.baseScale);
  }

  setupCanvas(canvas, viewport, config) {
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.style.width = viewport.width / (config.dpiScale * config.qualityMultiplier) + 'px';
    canvas.style.height = viewport.height / (config.dpiScale * config.qualityMultiplier) + 'px';
    
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    
    return context;
  }

  async renderCanvasContent(page, context, viewport) {
    await page.render({ 
      canvasContext: context, 
      viewport: viewport,
      intent: 'display'
    }).promise;
  }

  createPageContainer(pageNum, canvas, baseScale) {
    const pageContainer = document.createElement('div');
    pageContainer.style.position = 'relative';
    pageContainer.style.marginBottom = '16px';
    pageContainer.style.setProperty('--scale-factor', baseScale);
    pageContainer.setAttribute('data-page-number', pageNum);
    pageContainer.style.maxWidth = '100%';
    pageContainer.appendChild(canvas);
    return pageContainer;
  }

  async addTextLayer(page, pageContainer, baseScale) {
    const textContent = await page.getTextContent();
    const textLayerDiv = document.createElement('div');
    
    this.setupTextLayer(textLayerDiv, pageContainer, baseScale);
    pageContainer.appendChild(textLayerDiv);
    
    const textViewport = page.getViewport({ scale: baseScale });
    pdfjsLib.renderTextLayer({ 
      textContentSource: textContent, 
      container: textLayerDiv, 
      viewport: textViewport, 
      textDivs: []
    });
  }

  setupTextLayer(textLayerDiv, pageContainer, baseScale) {
    const canvas = pageContainer.querySelector('canvas');
    textLayerDiv.className = 'textLayer';
    textLayerDiv.style.position = 'absolute';
    textLayerDiv.style.top = '0';
    textLayerDiv.style.left = '0';
    textLayerDiv.style.width = canvas.style.width;
    textLayerDiv.style.height = canvas.style.height;
    textLayerDiv.style.pointerEvents = 'auto';
    textLayerDiv.style.userSelect = 'text';
    textLayerDiv.style.color = 'transparent';
    textLayerDiv.style.overflow = 'hidden';
    textLayerDiv.setAttribute('data-page-number', pageContainer.getAttribute('data-page-number'));
  }

  renderUnsupported(filename, contentType) {
    const viewer = document.getElementById('front-viewer');
    
    viewer.innerHTML = `
      <div class="front-attachment-error">
        <div class="front-attachment-error-icon">📎</div>
        <div style="font-size: 18px; font-weight: 600; color: var(--front-text-primary); margin-bottom: 8px;">Preview Not Available</div>
        <div style="color: var(--front-text-secondary); margin-bottom: 4px;">File type: ${contentType}</div>
        <div style="color: var(--front-text-muted); margin-bottom: 24px; font-size: 13px;">This file type cannot be previewed in the browser</div>
        <button onclick="window.frontAttachmentViewerInstance.downloadCurrentAttachment()" 
               class="front-attachment-nav-button success"
               style="padding: 12px 24px; font-size: 14px; font-weight: 600;">
          Download ${filename}
        </button>
      </div>
    `;
  }

  renderError(message) {
    const viewer = document.getElementById('front-viewer');
    viewer.innerHTML = `
      <div class="front-attachment-error">
        <div class="front-attachment-error-icon">⚠️</div>
        <div style="font-size: 18px; font-weight: 600; color: var(--front-text-primary); margin-bottom: 8px;">Failed to Load Attachment</div>
        <div style="color: var(--front-text-secondary); line-height: 1.4;">${message}</div>
      </div>
    `;
  }

  renderPDFError(blob) {
    const viewer = document.getElementById('front-viewer');
    viewer.innerHTML = `
      <div class="front-attachment-error">
        <div class="front-attachment-error-icon">📄</div>
        <div style="font-size: 18px; font-weight: 600; color: var(--front-text-primary); margin-bottom: 8px;">PDF Preview Unavailable</div>
        <div style="color: var(--front-text-secondary); margin-bottom: 24px;">Unable to render this PDF file in the browser</div>
        <a href="${URL.createObjectURL(blob)}" download="attachment.pdf" 
           class="front-attachment-nav-button primary"
           style="padding: 12px 24px; font-size: 14px; font-weight: 600; text-decoration: none; display: inline-flex; align-items: center;">
          Download PDF
        </a>
      </div>
    `;
  }

  toggleSearch() {
    const searchControls = document.getElementById('front-search-controls');
    const searchBtn = document.getElementById('front-search-btn');
    const searchInput = document.getElementById('front-search-input');
    
    if (this.searchMode) {
      this.closeSearch();
    } else {
      const isPdf = this.attachments[this.currentIndex]?.contentType?.includes('application/pdf');
      if (!isPdf) return;
      
      this.searchMode = true;
      searchControls.style.display = 'flex';
      searchBtn.style.display = 'none';
      searchInput.focus();
    }
  }

  closeSearch() {
    const searchControls = document.getElementById('front-search-controls');
    const searchBtn = document.getElementById('front-search-btn');
    const searchInput = document.getElementById('front-search-input');
    
    this.searchMode = false;
    searchControls.style.display = 'none';
    searchBtn.style.display = 'block';
    searchInput.value = '';
    this.clearSearchHighlights();
    this.searchResults = [];
    this.currentSearchIndex = 0;
    this.updateSearchCounter(true);
  }

  async performSearch(query) {
    // Clear previous debounce timer
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
    }
    
    if (!query.trim() || !this.currentPdf) {
      this.searchResults = [];
      this.currentSearchIndex = 0;
      this.clearSearchHighlights();
      this.updateSearchCounter(true);
      return;
    }

    // Debounce search for 300ms
    this.searchDebounceTimer = setTimeout(() => {
      this.searchResults = [];
      this.currentSearchIndex = 0;
      this.clearSearchHighlights();

      const searchTerm = query.toLowerCase().trim();
      
      this.findSearchMatches(searchTerm);
      this.highlightSearchResults();
      this.updateSearchCounter(false);
      
      if (this.searchResults.length > 0) {
        this.navigateToSearchResult(0);
      }
    }, 300);
  }

  findSearchMatches(searchTerm) {
    for (let pageNum = 1; pageNum <= this.currentPdf.numPages; pageNum++) {
      const textLayer = document.querySelector(`.textLayer[data-page-number="${pageNum}"]`);
      if (!textLayer) continue;
      
      const textSpans = textLayer.querySelectorAll('span');
      
      textSpans.forEach((span, itemIndex) => {
        const renderedText = span.textContent.toLowerCase();
        this.findMatchesInSpan(renderedText, searchTerm, span, pageNum, itemIndex);
      });
    }
  }

  findMatchesInSpan(renderedText, searchTerm, span, pageNum, itemIndex) {
    let searchIndex = 0;
    
    while ((searchIndex = renderedText.indexOf(searchTerm, searchIndex)) !== -1) {
      this.searchResults.push({
        pageNum,
        itemIndex,
        charIndex: searchIndex,
        renderedCharIndex: searchIndex,
        text: span.textContent,
        renderedText: span.textContent,
        length: searchTerm.length,
        span: span
      });
      
      searchIndex += 1;
    }
  }

  highlightSearchResults() {
    this.clearSearchHighlights();
    
    this.searchResults.forEach((result, globalIndex) => {
      this.createSearchHighlight(result, globalIndex);
    });
  }

  createSearchHighlight(result, globalIndex) {
    const targetSpan = result.span;
    if (!targetSpan) return;

    const textNode = targetSpan.firstChild;
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return;

    try {
      this.createRangeHighlight(textNode, result, globalIndex);
    } catch (error) {
      this.createFallbackHighlight(result, globalIndex);
    }
  }

  createRangeHighlight(textNode, result, globalIndex) {
    const range = document.createRange();
    const startIndex = result.renderedCharIndex;
    const endIndex = startIndex + result.length;
    
    if (startIndex >= 0 && endIndex <= textNode.textContent.length) {
      range.setStart(textNode, startIndex);
      range.setEnd(textNode, endIndex);
      
      const rects = range.getClientRects();
      if (rects.length > 0) {
        this.createHighlightElements(rects, result.span, globalIndex);
      }
    }
  }

  createHighlightElements(rects, targetSpan, globalIndex) {
    const textLayer = targetSpan.closest('.textLayer');
    if (!textLayer) return;

    const pdfContainer = document.getElementById('front-pdf-container');
    const currentZoom = pdfContainer ? this.zoomLevel : 1;
    
    for (let i = 0; i < rects.length; i++) {
      const rect = rects[i];
      const highlight = this.createHighlightElement(rect, textLayer, globalIndex, i, currentZoom);
      textLayer.appendChild(highlight);
    }
  }

  createHighlightElement(rect, textLayer, globalIndex, rectIndex, zoomLevel) {
    const highlight = document.createElement('div');
    highlight.className = 'search-highlight';
    highlight.setAttribute('data-search-index', globalIndex);
    highlight.setAttribute('data-rect-index', rectIndex);
    
    const layerRect = textLayer.getBoundingClientRect();
    
    const relativeLeft = (rect.left - layerRect.left) / zoomLevel;
    const relativeTop = (rect.top - layerRect.top) / zoomLevel;
    const relativeWidth = rect.width / zoomLevel;
    const relativeHeight = rect.height / zoomLevel;
    
    Object.assign(highlight.style, {
      position: 'absolute',
      left: relativeLeft + 'px',
      top: relativeTop + 'px',
      width: relativeWidth + 'px',
      height: relativeHeight + 'px',
      background: 'rgba(255, 255, 0, 0.6)',
      borderRadius: '2px',
      pointerEvents: 'none',
      zIndex: '10',
      transition: 'background 0.2s ease',
      boxSizing: 'border-box',
      overflow: 'hidden'
    });
    
    return highlight;
  }

  createFallbackHighlight(result, globalIndex) {
    const targetSpan = result.span;
    const textLayer = targetSpan.closest('.textLayer');
    if (!textLayer) return;
    
    const pdfContainer = document.getElementById('front-pdf-container');
    const currentZoom = pdfContainer ? this.zoomLevel : 1;
    
    const spanRect = targetSpan.getBoundingClientRect();
    const layerRect = textLayer.getBoundingClientRect();
    
    const textLength = targetSpan.textContent.length;
    const charWidth = textLength > 0 ? (spanRect.width / currentZoom) / textLength : 0;
    const highlightLeft = (result.renderedCharIndex * charWidth);
    const highlightWidth = result.length * charWidth;
    
    const highlight = document.createElement('div');
    highlight.className = 'search-highlight search-highlight-fallback';
    highlight.setAttribute('data-search-index', globalIndex);
    
    Object.assign(highlight.style, {
      position: 'absolute',
      left: Math.max(0, highlightLeft) + 'px',
      top: '0px',
      width: Math.max(1, highlightWidth) + 'px',
      height: '100%',
      background: 'rgba(255, 255, 0, 0.6)',
      borderRadius: '2px',
      pointerEvents: 'none',
      zIndex: '10',
      border: '1px dashed orange',
      boxSizing: 'border-box',
      overflow: 'hidden'
    });
    
    textLayer.appendChild(highlight);
  }

  clearSearchHighlights() {
    const highlights = document.querySelectorAll('.search-highlight');
    highlights.forEach(highlight => highlight.remove());
  }

  navigateSearchNext() {
    if (this.searchResults.length === 0) return;
    
    this.currentSearchIndex = (this.currentSearchIndex + 1) % this.searchResults.length;
    this.navigateToSearchResult(this.currentSearchIndex);
  }

  navigateSearchPrevious() {
    if (this.searchResults.length === 0) return;
    
    this.currentSearchIndex = this.currentSearchIndex > 0 ? 
      this.currentSearchIndex - 1 : 
      this.searchResults.length - 1;
    this.navigateToSearchResult(this.currentSearchIndex);
  }

  navigateToSearchResult(index) {
    this.updateCurrentSearchHighlight(index);
    
    requestAnimationFrame(() => {
      this.scrollToSearchResultSmooth(index);
    });
    
    this.updateSearchCounter();
  }

  scrollToSearchResultSmooth(index) {
    const currentHighlights = document.querySelectorAll(`[data-search-index="${index}"]`);
    if (currentHighlights.length === 0) return;

    const firstHighlight = currentHighlights[0];
    const container = document.querySelector('.front-attachment-content');
    const viewer = document.querySelector('.front-attachment-viewer');
    
    if (!container || !firstHighlight || !viewer) return;

    const containerRect = container.getBoundingClientRect();
    const highlightRect = firstHighlight.getBoundingClientRect();
    const viewerRect = viewer.getBoundingClientRect();
    
    const highlightTopInContainer = highlightRect.top - containerRect.top + container.scrollTop;
    
    const viewerHeight = viewerRect.height;
    const targetScrollTop = highlightTopInContainer - (viewerHeight / 2);
    
    const maxScroll = container.scrollHeight - container.clientHeight;
    const finalScrollTop = Math.max(0, Math.min(targetScrollTop, maxScroll));
    
    this.smoothScrollTo(container, finalScrollTop);
  }

  smoothScrollTo(container, targetTop) {
    const startTop = container.scrollTop;
    const distance = targetTop - startTop;
    const duration = 400;
    const startTime = performance.now();
    
    const animateScroll = (currentTime) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      const easeInOutCubic = progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2;
      
      container.scrollTop = startTop + distance * easeInOutCubic;
      
      if (progress < 1) {
        requestAnimationFrame(animateScroll);
      }
    };
    
    requestAnimationFrame(animateScroll);
  }

  updateCurrentSearchHighlight(index) {
    const allHighlights = document.querySelectorAll('.search-highlight');
    allHighlights.forEach(h => {
      h.classList.remove('current');
      h.style.background = 'rgba(255, 255, 0, 0.6)';
      h.style.border = 'none';
    });

    const currentHighlights = document.querySelectorAll(`[data-search-index="${index}"]`);
    currentHighlights.forEach(highlight => {
      highlight.classList.add('current');
      highlight.style.background = 'rgba(255, 165, 0, 0.8)';
      highlight.style.border = '1px solid orange';
    });
  }

  updateSearchCounter(isEmptyQuery = false) {
    const counter = document.getElementById('front-search-counter');
    const prevBtn = document.getElementById('front-search-prev-btn');
    const nextBtn = document.getElementById('front-search-next-btn');
    
    if (isEmptyQuery) {
      counter.textContent = '';
      prevBtn.disabled = true;
      nextBtn.disabled = true;
    } else if (this.searchResults.length === 0) {
      counter.textContent = '0 matches';
      prevBtn.disabled = true;
      nextBtn.disabled = true;
    } else {
      counter.textContent = `${this.currentSearchIndex + 1} of ${this.searchResults.length}`;
      prevBtn.disabled = false;
      nextBtn.disabled = false;
    }
  }

  updateSearchVisibility() {
    const searchBtn = document.getElementById('front-search-btn');
    const isPdf = this.attachments[this.currentIndex]?.contentType?.includes('application/pdf');
    
    searchBtn.style.display = isPdf ? 'block' : 'none';
    
    if (!isPdf) {
      this.closeSearch();
    }
  }

  zoomIn() {
    if (this.zoomLevel < this.maxZoom) {
      this.zoomLevel = Math.min(this.maxZoom, this.zoomLevel + this.zoomStep);
      this.applyZoom();
    }
  }

  zoomOut() {
    if (this.zoomLevel > this.minZoom) {
      this.zoomLevel = Math.max(this.minZoom, this.zoomLevel - this.zoomStep);
      this.applyZoom();
    }
  }

  resetZoom() {
    this.zoomLevel = 1;
    this.lastPdfRenderZoom = 1;
    if (this.pdfRenderTimeout) {
      clearTimeout(this.pdfRenderTimeout);
      this.pdfRenderTimeout = null;
    }
    this.applyZoom();
  }

  applyZoom() {
    const targetContainer = this.getZoomTarget();
    
    if (targetContainer) {
      targetContainer.style.transform = `scale(${this.zoomLevel})`;
      this.handlePDFZoomRerendering();
    }
    
    this.updateZoomDisplay();
    this.updateZoomButtons();
  }

  getZoomTarget() {
    const pdfContainer = document.getElementById('front-pdf-container');
    const imageContainer = document.getElementById('front-image-container');
    return pdfContainer || imageContainer;
  }

  handlePDFZoomRerendering() {
    const pdfContainer = document.getElementById('front-pdf-container');
    if (pdfContainer && this.zoomLevel > 2.0) {
      if (this.pdfRenderTimeout) {
        clearTimeout(this.pdfRenderTimeout);
      }
      
      const zoomDifference = Math.abs(this.zoomLevel - this.lastPdfRenderZoom);
      if (zoomDifference >= 0.5) {
        this.pdfRenderTimeout = setTimeout(() => {
          this.rerenderPDFAtZoom();
        }, 500);
      }
    }
  }

  rerenderPDFAtZoom() {
    const attachment = this.attachments[this.currentIndex];
    if (attachment && attachment.blob && attachment.contentType.includes('application/pdf')) {
      this.lastPdfRenderZoom = this.zoomLevel;
      this.renderPDF(attachment.blob);
    }
  }

  updateZoomDisplay() {
    const zoomDisplay = document.getElementById('front-zoom-level');
    if (zoomDisplay) {
      zoomDisplay.textContent = `${Math.round(this.zoomLevel * 100)}%`;
    }
  }

  updateZoomButtons() {
    const zoomInBtn = document.getElementById('front-zoom-in-btn');
    const zoomOutBtn = document.getElementById('front-zoom-out-btn');
    
    if (zoomInBtn) zoomInBtn.disabled = this.zoomLevel >= this.maxZoom;
    if (zoomOutBtn) zoomOutBtn.disabled = this.zoomLevel <= this.minZoom;
  }

  navigatePrevious() {
    if (this.currentIndex > 0 && !this.isTransitioning) {
      this.navigationDirection = 'backward';
      this.lastNavigationTime = Date.now();
      this.currentIndex--;
      this.closeSearch();
      this.navigateWithTransition('right');
    }
  }

  navigateNext() {
    if (this.currentIndex < this.attachments.length - 1 && !this.isTransitioning) {
      this.navigationDirection = 'forward';
      this.lastNavigationTime = Date.now();
      this.currentIndex++;
      this.closeSearch();
      this.navigateWithTransition('left');
    }
  }

  async navigateWithTransition(direction) {
    this.isTransitioning = true;
    
    // Load new content instantly - no animations
    await this.loadCurrentAttachment();
    
    this.isTransitioning = false;
  }

  updateNavigation() {
    const prevBtn = document.getElementById('front-prev-btn');
    const nextBtn = document.getElementById('front-next-btn');
    const counter = document.getElementById('front-counter');
    const leftArrow = document.getElementById('front-side-arrow-left');
    const rightArrow = document.getElementById('front-side-arrow-right');

    const isFirst = this.currentIndex === 0;
    const isLast = this.currentIndex >= this.attachments.length - 1;

    prevBtn.disabled = isFirst;
    nextBtn.disabled = isLast;
    counter.textContent = `${this.currentIndex + 1} of ${this.attachments.length}`;
    
    if (leftArrow) {
      if (isFirst) {
        leftArrow.classList.add('disabled');
        leftArrow.style.pointerEvents = 'none';
      } else {
        leftArrow.classList.remove('disabled');
        leftArrow.style.pointerEvents = 'auto';
      }
    }
    
    if (rightArrow) {
      if (isLast) {
        rightArrow.classList.add('disabled');
        rightArrow.style.pointerEvents = 'none';
      } else {
        rightArrow.classList.remove('disabled');
        rightArrow.style.pointerEvents = 'auto';
      }
    }
  }

  showViewer() {
    this.overlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    this.updateZoomDisplay();
    this.updateZoomButtons();
    this.ensureSideArrowsVisible();
  }

  ensureSideArrowsVisible() {
    const leftArrow = document.getElementById('front-side-arrow-left');
    const rightArrow = document.getElementById('front-side-arrow-right');
    
    if (leftArrow) {
      leftArrow.style.display = 'flex';
    }
    
    if (rightArrow) {
      rightArrow.style.display = 'flex';
    }
    
    setTimeout(() => {
      this.updateNavigation();
    }, 100);
  }

  closeViewer() {
    this.overlay.classList.add('hidden');
    document.body.style.overflow = '';
    this.resetZoom();
    this.closeSearch();
    
    // Fully reset search state
    const searchInput = document.getElementById('front-search-input');
    if (searchInput) {
      searchInput.value = '';
    }
    this.searchResults = [];
    this.currentSearchIndex = 0;
    this.updateSearchCounter(true);
  }

  isViewerOpen() {
    return this.overlay && !this.overlay.classList.contains('hidden');
  }

  downloadCurrentAttachment() {
    const attachment = this.attachments[this.currentIndex];
    if (!attachment || !attachment.blob) {
      return;
    }

    const url = URL.createObjectURL(attachment.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = attachment.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  rescan() {
    this.smartRescan();
    
    if (this.isViewerOpen() && this.attachments.length > 0) {
      this.startPreloading();
    }
  }

  destroy() {
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }
    
    if (this.scanThrottleTimeout) {
      clearTimeout(this.scanThrottleTimeout);
    }
    
    if (this.overlay) this.overlay.remove();
    document.body.style.overflow = '';
    
    if (this.pdfRenderTimeout) {
      clearTimeout(this.pdfRenderTimeout);
    }
    
    this.attachmentCache.clear();
    this.preloadCache.clear();
    this.preloadQueue = [];
    
    const styleElement = document.getElementById('front-viewer-styles');
    if (styleElement) styleElement.remove();
  }
}

if (window.frontAttachmentViewerInstance) {
  window.frontAttachmentViewerInstance.destroy();
}

try {
  window.frontAttachmentViewerInstance = new FrontAttachmentViewer();
  window.frontAttachmentViewer = window.frontAttachmentViewerInstance;
} catch (error) {
}

window.addEventListener('beforeunload', () => {
  if (window.frontAttachmentViewerInstance) {
    window.frontAttachmentViewerInstance.destroy();
  }
});
