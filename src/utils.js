/**
 * Utility functions for SlackSnap extension
 */

/**
 * Format date according to specified format
 * @param {Date} date - Date to format
 * @param {string} format - Format string (e.g., "YYYYMMDD-HHmm")
 * @returns {string} Formatted date string
 */
function formatDate(date, format) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  
  return format
    .replace('YYYY', year)
    .replace('MM', month)
    .replace('DD', day)
    .replace('HH', hours)
    .replace('mm', minutes);
}

/**
 * Clean text content for markdown export
 * @param {string} text - Raw text content
 * @returns {string} Cleaned text
 */
function cleanText(text) {
  if (!text) return '';
  
  // Use browser's built-in HTML entity decoding (elegant and comprehensive)
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = text;
  const decodedText = tempDiv.textContent || tempDiv.innerText || '';
  
  return decodedText
    .trim()
    // Clean up whitespace
    .replace(/\n\s+/g, '\n') // Remove extra whitespace
    .replace(/\u00A0/g, ' ') // Replace non-breaking spaces
    .replace(/\s+/g, ' '); // Normalize whitespace
}

/**
 * Extract channel name from current URL or page title
 * @returns {string} Channel name
 */
function extractChannelName() {
  try {
    console.log('🏷️ Extracting channel name...');
    console.log('📍 Current URL:', window.location.href);
    console.log('📄 Page title:', document.title);
    
    // Try multiple methods to get channel name
    
    // Method 1: From URL path patterns
    const urlPatterns = [
      /\/messages\/([^\/\?]+)/,           // /messages/CHANNEL_ID
      /\/archives\/([^\/\?]+)/,           // /archives/CHANNEL_ID  
      /\/channels\/([^\/\?]+)/,           // /channels/CHANNEL_NAME
      /\/client\/([^\/]+)\/([^\/\?]+)/,   // /client/TEAM/CHANNEL
    ];
    
    for (const pattern of urlPatterns) {
      const urlMatch = window.location.pathname.match(pattern);
      if (urlMatch) {
        const channelId = urlMatch[1] || urlMatch[2];
        console.log(`✅ Found channel ID from URL: ${channelId}`);
        
        // Try to get human-readable name from page elements
        const readableName = getReadableChannelName() || channelId;
        return sanitizeChannelName(readableName);
      }
    }
    
    // Method 2: From page title 
    const titlePatterns = [
      /^#([^|]+?)\s*\|/,                    // #channel-name | Workspace
      /^([^|]+?)\s*\|\s*(.+?)\s*\|\s*Slack$/,  // channel-name | Workspace | Slack
      /^(.+?)\s*-\s*Slack$/,                // channel-name - Slack
      /^(.+?)\s*\|\s*Slack$/                // channel-name | Slack
    ];
    
    for (const pattern of titlePatterns) {
      const titleMatch = document.title.match(pattern);
      if (titleMatch) {
        const channelName = titleMatch[1].trim();
        console.log(`✅ Found channel name from title: ${channelName}`);
        return sanitizeChannelName(channelName);
      }
    }
    
    // Method 3: From DOM elements (channel header, breadcrumbs, etc.)
    const readableName = getReadableChannelName();
    if (readableName) {
      console.log(`✅ Found channel name from DOM: ${readableName}`);
      return sanitizeChannelName(readableName);
    }
    
    console.warn('⚠️ Could not extract channel name, using fallback');
    return 'slack-channel';
    
  } catch (error) {
    console.error('❌ Failed to extract channel name:', error);
    return 'slack-channel';
  }
}

/**
 * Get human-readable channel name from DOM elements
 * @returns {string|null} Channel name or null if not found
 */
function getReadableChannelName() {
  // Try various selectors for channel name in the UI
  const channelSelectors = [
    '[data-qa="channel_header_name"]',
    '[data-qa="channel_name"]', 
    '.p-channel_sidebar__name',
    '.p-channel_header__name',
    '.c-channel_header__name',
    '[data-qa="channel-header-name"]',
    '[aria-label*="channel name"]',
    '.p-message_pane__top_title',
    '[data-qa="channel_sidebar_name"]'
  ];
  
  for (const selector of channelSelectors) {
    const element = document.querySelector(selector);
    if (element && element.textContent && element.textContent.trim()) {
      let channelName = element.textContent.trim();
      // Remove # prefix if present
      channelName = channelName.replace(/^#/, '');
      console.log(`📋 Found channel name via selector "${selector}": ${channelName}`);
      return channelName;
    }
  }
  
  // Try to find channel name in breadcrumbs or headers
  const breadcrumbSelectors = [
    '.p-top_nav__breadcrumb',
    '.p-client_header__breadcrumb', 
    '[data-qa="breadcrumb"]'
  ];
  
  for (const selector of breadcrumbSelectors) {
    const breadcrumb = document.querySelector(selector);
    if (breadcrumb) {
      const links = breadcrumb.querySelectorAll('a, span');
      if (links.length > 0) {
        const lastLink = links[links.length - 1];
        const channelName = lastLink.textContent?.trim()?.replace(/^#/, '');
        if (channelName && channelName.length > 0) {
          console.log(`🍞 Found channel name in breadcrumb: ${channelName}`);
          return channelName;
        }
      }
    }
  }
  
  return null;
}

/**
 * Sanitize channel name for use in filename
 * @param {string} name - Raw channel name
 * @returns {string} Sanitized name
 */
function sanitizeChannelName(name) {
  if (!name) return 'slack-channel';
  
  return name
    .replace(/^#/, '')                    // Remove # prefix
    .replace(/[^\w\-\.]/g, '-')          // Replace invalid chars with dash
    .replace(/\-+/g, '-')                // Collapse multiple dashes
    .replace(/^-|-$/g, '')               // Remove leading/trailing dashes
    .toLowerCase()                        // Lowercase for consistency
    .substring(0, 50)                     // Limit length
    || 'slack-channel';                   // Fallback if empty
}

/**
 * Generate filename for export
 * @param {string} channelName - Name of the channel
 * @param {Object} config - Configuration object
 * @returns {string} Generated filename
 */
function generateFilename(channelName, config) {
  const now = new Date();
  const dateStr = formatDate(now, 'YYYYMMDD-HHmm');
  const cleanChannel = channelName.replace(/[^a-zA-Z0-9-_]/g, '-');
  
  return config.fileNameFormat
    .replace('YYYYMMDD-HHmm', dateStr)
    .replace('{channel}', cleanChannel);
}

/**
 * Show notification to user
 * @param {string} message - Notification message
 * @param {string} type - Notification type ('success' or 'error')
 */
function showNotification(message, type = 'success') {
  try {
    // Create notification element
    const notification = document.createElement('div');
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: ${type === 'success' ? '#28a745' : '#dc3545'};
      color: white;
      padding: 12px 16px;
      border-radius: 4px;
      z-index: 10000;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      max-width: 300px;
    `;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    // Remove after 3 seconds
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 3000);
  } catch (error) {
    console.error('Failed to show notification:', error);
  }
}

/**
 * Escape markdown special characters in text
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeMarkdown(text) {
  if (!text) return '';
  
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/`/g, '\\`')
    .replace(/~/g, '\\~')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/!/g, '\\!')
    .replace(/#/g, '\\#')
    .replace(/\|/g, '\\|');
}

// Make functions available globally
if (typeof window !== 'undefined') {
  window.SlackSnapUtils = {
    formatDate,
    cleanText,
    extractChannelName,
    generateFilename,
    showNotification,
    escapeMarkdown
  };
} 