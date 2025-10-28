class PopupManager {
  constructor() {
    this.elements = {
      card: document.getElementById('statusCard'),
      title: document.getElementById('statusTitle'),
      desc: document.getElementById('statusDesc'),
      short: document.getElementById('stateShort'),
      refreshBtn: document.getElementById('refreshBtn')
    };

    // Defer init so DOM is stable
    Promise.resolve().then(() => this.init());
  }

  async init() {
    await this.checkStatus();
    this.setupEventListeners();
  }

  // Check whether active tab is frontapp and update UI
  async checkStatus() {
    try {
      if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tab = Array.isArray(tabs) ? tabs[0] : tabs;

        if (tab && tab.url && tab.url.includes('frontapp.com')) {
          this.setStatus(true, 'Working', 'Extension is active on frontapp.com');
          return;
        }
      }

      // fallback: not working
      this.setStatus(false, 'Not working', 'No Front tab detected. Open frontapp.com to enable the extension.');
    } catch (err) {
      console.error('checkStatus error', err);
      this.setStatus(false, 'Error', 'Unable to determine tab status.');
    }
  }

  setupEventListeners() {
    if (this.elements.refreshBtn) {
      this.elements.refreshBtn.addEventListener('click', () => this.handleRefresh());
    } else {
      console.warn('refreshBtn missing from DOM');
    }

    // Optional: update status when popup is focused again
    // (some browsers recreate popups; re-run check on focus)
    window.addEventListener('focus', () => this.checkStatus().catch(() => {}));
  }

  // Try to run the in-page rescan if present
  async handleRefresh() {
    const btn = this.elements.refreshBtn;
    if (!btn) return;

    // Provide immediate feedback
    this.showButtonFeedback(btn, 'Checking...', true);

    try {
      // Ensure chrome.scripting exists (Manifest V3)
      if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query && chrome.scripting && chrome.scripting.executeScript) {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tab = Array.isArray(tabs) ? tabs[0] : tabs;

        if (!tab || !tab.id || !tab.url || !tab.url.includes('frontapp.com')) {
          this.setStatus(false, 'Not working', 'No Front tab detected. Navigate to frontapp.com and try again.');
          this.showButtonFeedback(btn, 'No Front tab', false);
          return;
        }

        // Execute script in page context to call frontAttachmentViewer.rescan()
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            // Run in page context
            try {
              if (window.frontAttachmentViewer && typeof window.frontAttachmentViewer.rescan === 'function') {
                window.frontAttachmentViewer.rescan();
                const count = Array.isArray(window.frontAttachmentViewer.attachments) ? window.frontAttachmentViewer.attachments.length : null;
                return { ok: true, count };
              }
              return { ok: false, error: 'not_initialized' };
            } catch (e) {
              return { ok: false, error: e && e.message ? e.message : String(e) };
            }
          }
        });

        // results is an array of InjectionResult objects; gather first
        const res = Array.isArray(results) && results[0] && results[0].result ? results[0].result : null;

        if (res && res.ok) {
          const countText = (typeof res.count === 'number') ? ` (${res.count} attachments)` : '';
          this.setStatus(true, 'Working', `Refreshed${countText}`);
          this.showButtonFeedback(btn, 'Refreshed', true);
        } else {
          // If not initialized on the page, instruct user
          const err = res && res.error ? res.error : 'unknown';
          console.warn('refresh result', res);
          if (err === 'not_initialized') {
            this.setStatus(false, 'Not working', 'Viewer not initialized on the page. Click an attachment once in Front to initialize.');
            this.showButtonFeedback(btn, 'Not initialized', false);
          } else {
            this.setStatus(false, 'Error', 'Refresh failed: ' + err);
            this.showButtonFeedback(btn, 'Error', false);
          }
        }

      } else if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        // Fallback: notify background script to refresh
        chrome.runtime.sendMessage({ action: 'refreshAttachments' }, (resp) => {
          if (chrome.runtime.lastError) {
            console.warn('sendMessage error', chrome.runtime.lastError);
            this.showButtonFeedback(btn, 'Error', false);
            this.setStatus(false, 'Error', 'Refresh failed');
            return;
          }
          this.showButtonFeedback(btn, 'Refreshed', true);
          this.setStatus(true, 'Working', 'Refresh requested');
        });
      } else {
        // No chrome APIs available (testing environment)
        this.showButtonFeedback(btn, 'Refreshed', true);
        this.setStatus(true, 'Working', 'Simulated refresh (no chrome APIs).');
      }
    } catch (err) {
      console.error('handleRefresh error', err);
      this.showButtonFeedback(btn, 'Error', false);
      this.setStatus(false, 'Error', 'Unexpected error during refresh.');
    }
  }

  // Set the status card UI
  setStatus(isActive, titleText, descText) {
    const root = this.elements.card;
    if (!root) return;

    root.classList.remove('status-active', 'status-inactive', 'status-error');
    root.classList.add(isActive ? 'status-active' : 'status-inactive');

    if (this.elements.title) this.elements.title.textContent = titleText || '';
    if (this.elements.desc) this.elements.desc.textContent = descText || '';
    if (this.elements.short) this.elements.short.textContent = titleText || '';
  }

  // show short lived button feedback and restore previous text
  showButtonFeedback(button, text, ok = true) {
    if (!button) return;
    const originalText = button.textContent;
    const originalBg = button.style.background;
    const originalColor = button.style.color;

    // visual styles for success / failure
    if (ok) {
      button.textContent = text;
      button.style.background = '#34a853';
      button.style.color = '#fff';
    } else {
      button.textContent = text;
      button.style.background = '#ea4335';
      button.style.color = '#fff';
    }

    // restore after short delay
    setTimeout(() => {
      button.textContent = originalText;
      button.style.background = originalBg;
      button.style.color = originalColor;
    }, 1500);
  }
}

// init when DOM ready
document.addEventListener('DOMContentLoaded', () => {
  try {
    new PopupManager();
  } catch (err) {
    console.error('Popup init error', err);
  }
});
