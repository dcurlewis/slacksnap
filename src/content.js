/**
 * SlackSnap content script - handles Slack message extraction and export
 * Uses Slack's API for reliable message and user data extraction
 */

/**
 * Message listener for background script commands
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('📨 Content script received message:', message);
  
  if (message.action === 'EXPORT_MESSAGES') {
    console.log('🚀 Starting export process...');
    
    // Check if utilities are available
    if (typeof window.SlackSnapUtils !== 'undefined') {
      window.SlackSnapUtils.showNotification('Starting export...', 'success');
    } else {
      console.warn('⚠️ SlackSnapUtils not available yet');
    }
    
    // Try API method first - most reliable for large workspaces
    console.log('🔄 Attempting API-based export...');
    exportMessagesViaAPI()
      .then(() => {
        console.log('✅ API export completed successfully');
        sendResponse({ success: true, method: 'API' });
      })
      .catch(apiError => {
        console.warn('⚠️ API export failed, falling back to DOM method:', apiError);
        
        // Fallback to DOM scraping if API fails
        exportMessages()
          .then(() => {
            console.log('✅ DOM export completed successfully (API fallback)');
            sendResponse({ success: true, method: 'DOM_FALLBACK' });
          })
          .catch(domError => {
            console.error('❌ Both API and DOM export failed:', domError);
            if (typeof window.SlackSnapUtils !== 'undefined') {
              window.SlackSnapUtils.showNotification(`Export failed: ${apiError.message}`, 'error');
            }
            sendResponse({ success: false, error: `API: ${apiError.message}, DOM: ${domError.message}` });
          });
      });
    
    // Return true to indicate we'll respond asynchronously
    return true;
  }

  if (message.action === 'BATCH_EXPORT_CHANNEL') {
    console.log('📦 Batch export request for channel:', message.channelName);
    const { channelId, channelName, oldestTimestamp } = message;
    exportChannelViaAPI(channelId, channelName, oldestTimestamp)
      .then(result => {
        console.log(`✅ Batch export completed for ${channelName}:`, {
          messageCount: result.messageCount,
          markdownLength: result.markdown?.length,
          hasMarkdown: !!result.markdown
        });
        if (!result.markdown) {
          console.error('❌ No markdown generated for', channelName);
        }
        sendResponse({ success: true, ...result });
      })
      .catch(error => {
        console.error('❌ Batch export error for', channelName, ':', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // async response
  }

  if (message.action === 'GET_CURRENT_CHANNEL') {
    // Used by the popup's "Quick-add current channel" feature
    const channelId = getCurrentChannelId();
    const channelName = window.SlackSnapUtils ? window.SlackSnapUtils.extractChannelName() : null;
    sendResponse({ channelId, channelName });
    return;
  }
  
  console.log('❓ Unknown message action:', message.action);
});

/**
 * Main export function - orchestrates the entire export process
 * @returns {Promise<void>}
 */
async function exportMessages() {
  try {
    console.log('Starting enhanced message export...');
    
    // Load configuration
    const config = await getConfig();
    
    // Show initial progress
    if (typeof window.SlackSnapUtils !== 'undefined') {
      window.SlackSnapUtils.showNotification('Loading more messages...', 'success');
    }
    
    // First, try to load more messages by scrolling
    console.log('📜 Attempting to load more message history...');
    
    // Find the proper scroll container
    const scrollContainer = document.querySelector('.c-scrollbar__hider') || 
                           document.querySelector('.p-message_pane__content') ||
                           document.querySelector('[data-qa="slack_kit_scrollbar"]') ||
                           document.querySelector('.c-virtual_list__scroll_container');
    
    if (!scrollContainer) {
      console.warn('⚠️ No scroll container found, skipping auto-scroll');
    } else {
      console.log('✅ Found scroll container:', scrollContainer.className);
      
      // Get initial message count and scroll position
      let initialCount = document.querySelectorAll('[role="message"], [data-qa*="message"]').length;
      let previousCount = initialCount;
      let noNewMessagesCount = 0;
      
      console.log(`📊 Starting with ${initialCount} messages`);
      
      // Scroll to load more messages (up to 20 attempts)
      for (let i = 0; i < 20; i++) {
        // Scroll to very top to load older messages
        scrollContainer.scrollTop = 0;
        
        // Wait for Slack to load more messages
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        // Check how many messages we have now
        const currentCount = document.querySelectorAll('[role="message"], [data-qa*="message"]').length;
        const newMessages = currentCount - previousCount;
        
        console.log(`📜 Scroll ${i + 1}/20: ${currentCount} messages (${newMessages} new)`);
        
        // Update progress notification
        if (i % 3 === 0 && typeof window.SlackSnapUtils !== 'undefined') {
          window.SlackSnapUtils.showNotification(`Loading messages... ${currentCount} found`, 'success');
        }
        
        // If no new messages loaded, increment counter
        if (newMessages === 0) {
          noNewMessagesCount++;
          console.log(`⏸️ No new messages loaded (${noNewMessagesCount}/3)`);
          
          // If we've had 3 attempts with no new messages, we've probably reached the top
          if (noNewMessagesCount >= 3) {
            console.log('🔝 Likely reached top of message history');
            break;
          }
        } else {
          noNewMessagesCount = 0; // Reset counter if we got new messages
        }
        
        previousCount = currentCount;
      }
      
      const finalCount = document.querySelectorAll('[role="message"], [data-qa*="message"]').length;
      console.log(`✅ Finished scrolling: ${finalCount} total messages (${finalCount - initialCount} loaded)`);
    }
    
    // Extract messages from DOM
    const messages = extractVisibleMessages();
    
    if (messages.length === 0) {
      if (typeof window.SlackSnapUtils !== 'undefined') {
        window.SlackSnapUtils.showNotification('No messages found in current view', 'error');
      }
      return;
    }
    
    console.log(`📊 Successfully extracted ${messages.length} messages for export`);
    
    // Debug: Show sample of extracted timestamps
    const sampleMessages = messages.slice(0, 3);
    console.log('🕐 Sample timestamps extracted:');
    sampleMessages.forEach((msg, i) => {
      console.log(`  ${i + 1}. Sender: ${msg.sender}, Timestamp: "${msg.timestamp}", Content preview: "${msg.content.substring(0, 50)}..."`);
    });
    
    // Get channel information
    const channelName = window.SlackSnapUtils.extractChannelName();
    const filename = window.SlackSnapUtils.generateFilename(channelName, config);
    
    // Convert to markdown
    const markdownContent = convertToMarkdown(messages, channelName, config);
    
    // Send to background script for download (supports subdirectories)
    try {
      console.log('📥 Starting download via Chrome downloads API...');
      const response = await chrome.runtime.sendMessage({
        action: 'DOWNLOAD_FILE',
        data: {
          filename: filename,
          content: markdownContent,
          directory: config.downloadDirectory
        }
      });
      
      if (response && response.success) {
        console.log(`✅ File saved to Downloads/${config.downloadDirectory}/${filename}`);
        
        // Show success notification
        if (typeof window.SlackSnapUtils !== 'undefined') {
          window.SlackSnapUtils.showNotification(
            `Exported ${messages.length} messages to ${config.downloadDirectory}/${filename}`, 
            'success'
          );
        } else {
          console.log(`✅ Exported ${messages.length} messages to ${filename}`);
        }
      } else {
        throw new Error('Background download failed');
      }
      
    } catch (downloadError) {
      console.error('❌ Chrome downloads API failed:', downloadError);
      
      // Fallback: Direct download to Downloads root
      console.log('🔄 Trying direct download (will go to Downloads root)...');
      
      try {
        const blob = new Blob([markdownContent], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        
        const downloadLink = document.createElement('a');
        downloadLink.href = url;
        downloadLink.download = filename;
        downloadLink.style.display = 'none';
        
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);
        
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        
        console.log('✅ Direct download successful (Downloads root)');
        
        if (typeof window.SlackSnapUtils !== 'undefined') {
          window.SlackSnapUtils.showNotification(
            `Exported ${messages.length} messages to Downloads/${filename}`, 
            'success'
          );
        }
        
      } catch (fallbackError) {
        console.error('❌ Both download methods failed:', fallbackError);
        throw new Error('All download methods failed');
      }
    }
    
  } catch (error) {
    console.error('Export failed:', error);
    throw error;
  }
}

/**
 * Extract visible messages from Slack DOM
 * @returns {Array<Object>} Array of message objects
 */
function extractVisibleMessages() {
  const messages = [];
  
  try {
    console.log('Starting message extraction...');
    console.log('Current URL:', window.location.href);
    console.log('Page title:', document.title);
    
    // Try multiple selectors to find message containers
    const messageSelectors = [
      '[role="message"]',
      '[data-qa="message_container"]',
      '.c-message_kit__gutter',
      '.c-virtual_list__item',
      '.p-rich_text_block',
      '[data-qa="virtual_list_item"]',
      '.c-message_kit__message',
      '.c-message__message_blocks',
      '[class*="message"]',
      '.p-message_pane__message'
    ];
    
    let messageElements = [];
    
    // Find message containers using various selectors
    for (const selector of messageSelectors) {
      const elements = document.querySelectorAll(selector);
      console.log(`Trying selector "${selector}": found ${elements.length} elements`);
      if (elements.length > 0) {
        messageElements = Array.from(elements);
        console.log(`✅ Using selector: ${selector} (found ${elements.length} messages)`);
        break;
      }
    }
    
    if (messageElements.length === 0) {
      console.warn('❌ No messages found with primary selectors, trying comprehensive fallback...');
      
      // More comprehensive fallback search
      const fallbackSelectors = [
        '[data-qa*="message"]',
        '[class*="message"]',
        '[role*="message"]', 
        '.p-message_pane [data-qa*="virtual_list_item"]',
        '.c-scrollbar__content [data-qa]',
        '[data-qa="virtual_list"] [data-qa]',
        '.p-message_pane .c-virtual_list__item',
        '[aria-label*="message"]'
      ];
      
      for (const fallbackSelector of fallbackSelectors) {
        const fallbackElements = document.querySelectorAll(fallbackSelector);
        if (fallbackElements.length > 0) {
          messageElements = Array.from(fallbackElements);
          console.log(`✅ Fallback successful with "${fallbackSelector}": found ${fallbackElements.length} elements`);
          break;
        }
      }
      
      if (messageElements.length === 0) {
        console.error('❌ No message elements found with any selector');
        console.log('🔍 Analyzing page structure...');
        
        // Deep analysis of page structure
        const allElements = document.querySelectorAll('[data-qa], [role], [class*="message"], [class*="virtual"]');
        console.log(`Total potential elements: ${allElements.length}`);
        
        // Group by data-qa patterns
        const dataQaPatterns = {};
        Array.from(allElements).forEach(el => {
          const qa = el.getAttribute('data-qa');
          if (qa) {
            dataQaPatterns[qa] = (dataQaPatterns[qa] || 0) + 1;
          }
        });
        
        console.log('📊 data-qa patterns found:', dataQaPatterns);
        
        // Look for virtual list containers
        const virtualContainers = document.querySelectorAll('[class*="virtual"], [data-qa*="virtual"]');
        console.log(`🔄 Virtual list containers: ${virtualContainers.length}`);
        virtualContainers.forEach((container, i) => {
          console.log(`  Container ${i}:`, {
            'data-qa': container.getAttribute('data-qa'),
            className: container.className,
            children: container.children.length
          });
        });
      }
    }
    
    // Process each message element
    console.log(`Processing ${messageElements.length} message elements...`);
    for (let i = 0; i < messageElements.length; i++) {
      const element = messageElements[i];
      
      const messageData = extractMessageData(element);
      if (messageData && messageData.content && messageData.content.trim()) {
        messages.push(messageData);
        if (i % 50 === 0) { // Log every 50th message to avoid spam
          console.log(`✅ Processed ${i + 1}/${messageElements.length} messages...`);
        }
      }
    }
    
    // Sort messages by timestamp if available
    messages.sort((a, b) => {
      if (a.timestamp && b.timestamp) {
        return new Date(a.timestamp) - new Date(b.timestamp);
      }
      return 0;
    });
    
    console.log(`Extracted ${messages.length} valid messages`);
    return messages;
    
  } catch (error) {
    console.error('Failed to extract messages:', error);
    return [];
  }
}

/**
 * Extract data from a single message element
 * @param {Element} element - Message DOM element
 * @returns {Object|null} Message data object
 */
function extractMessageData(element) {
  try {
    const messageData = {
      sender: '',
      timestamp: '',
      content: '',
      threadReplies: []
    };
    
    // Extract sender name
    const senderSelectors = [
      '[data-qa="message_sender"]',
      '.c-message__sender',
      '.c-message_kit__sender',
      'button[data-qa*="user"]',
      '.p-rich_text_block .c-button-unstyled',
      '[class*="sender"]'
    ];
    
    for (const selector of senderSelectors) {
      const senderElement = element.querySelector(selector);
      if (senderElement) {
        messageData.sender = window.SlackSnapUtils.cleanText(senderElement.textContent);
        break;
      }
    }
    
    // Extract timestamp
    const timestampSelectors = [
      'time[datetime]',
      '[data-qa="message_time"]',
      '[data-qa*="time"]',
      '.c-timestamp',
      '[class*="timestamp"]',
      '[data-qa="message_timestamp"]',
      '.c-message_kit__timestamp',
      '[aria-label*="sent"]'
    ];
    
    for (const selector of timestampSelectors) {
      const timestampElement = element.querySelector(selector);
      if (timestampElement) {
        messageData.timestamp = timestampElement.getAttribute('datetime') || 
                               timestampElement.getAttribute('title') ||
                               timestampElement.getAttribute('aria-label') ||
                               timestampElement.textContent;
        break;
      }
    }
    
    // If no timestamp found, try to extract from parent elements and links
    if (!messageData.timestamp) {
      const parentWithTime = element.closest('[data-qa*="message"]');
      if (parentWithTime) {
        const timeEl = parentWithTime.querySelector('time, [data-qa*="time"], [class*="time"]');
        if (timeEl) {
          messageData.timestamp = timeEl.getAttribute('datetime') || 
                                 timeEl.getAttribute('title') ||
                                 timeEl.textContent;
        }
        
        // Also try to extract from Slack permalink URLs (these have actual dates!)
        const permalinkEl = parentWithTime.querySelector('a[href*="/p1"]');
        if (permalinkEl) {
          const href = permalinkEl.getAttribute('href');
          const match = href.match(/\/p(\d{10})\d*/);
          if (match) {
            messageData.timestamp = `p${match[1]}`;
            console.log('📎 Extracted timestamp from permalink:', messageData.timestamp);
          }
        }
      }
    }
    
    // Look for permalinks in the content itself which have actual dates
    if (messageData.content) {
      const contentPermalinkMatch = messageData.content.match(/\/p(\d{10})\d*/);
      if (contentPermalinkMatch) {
        messageData.timestamp = `p${contentPermalinkMatch[1]}`;
        console.log('📝 Extracted timestamp from content permalink:', messageData.timestamp);
      }
    }
    
    // Extract message content
    const contentSelectors = [
      '[data-qa="message_content"]',
      '.c-message__body',
      '.p-rich_text_section',
      '.c-message_kit__blocks',
      '[class*="message_content"]',
      '[class*="rich_text"]'
    ];
    
    for (const selector of contentSelectors) {
      const contentElement = element.querySelector(selector);
      if (contentElement) {
        messageData.content = extractTextContent(contentElement);
        break;
      }
    }
    
    // If no content found with specific selectors, try to get all text
    if (!messageData.content) {
      // Filter out sender and timestamp text from the main content
      let allText = element.textContent || '';
      if (messageData.sender) {
        allText = allText.replace(messageData.sender, '');
      }
      if (messageData.timestamp) {
        allText = allText.replace(messageData.timestamp, '');
      }
      messageData.content = window.SlackSnapUtils.cleanText(allText);
    }
    
    // Extract thread replies if they exist
    const threadSelectors = [
      '.c-message__thread',
      '[data-qa*="thread"]',
      '.p-thread_view__reply'
    ];
    
    for (const selector of threadSelectors) {
      const threadElements = element.querySelectorAll(selector);
      for (const threadElement of threadElements) {
        const threadData = extractMessageData(threadElement);
        if (threadData && threadData.content) {
          messageData.threadReplies.push(threadData);
        }
      }
    }
    
    // Return null if no meaningful content found
    if (!messageData.content && messageData.threadReplies.length === 0) {
      return null;
    }
    
    return messageData;
    
  } catch (error) {
    console.error('Failed to extract message data:', error);
    return null;
  }
}

/**
 * Extract text content from an element, preserving formatting
 * @param {Element} element - DOM element
 * @returns {string} Extracted text content
 */
function extractTextContent(element) {
  try {
    let content = '';
    
    // Handle code blocks specially
    const codeBlocks = element.querySelectorAll('pre, code, .c-mrkdwn__code');
    for (const codeBlock of codeBlocks) {
      const codeText = codeBlock.textContent || '';
      codeBlock.setAttribute('data-extracted', 'true');
      content += `\`\`\`\n${codeText}\n\`\`\`\n`;
    }
    
    // Handle links
    const links = element.querySelectorAll('a:not([data-extracted])');
    for (const link of links) {
      const linkText = link.textContent || '';
      const href = link.getAttribute('href') || '';
      if (href && !href.startsWith('#')) {
        link.setAttribute('data-extracted', 'true');
        content += `[${linkText}](${href}) `;
      }
    }
    
    // Get remaining text content
    const remainingText = element.textContent || '';
    content += window.SlackSnapUtils.cleanText(remainingText);
    
    // Clean up extraction markers
    const extractedElements = element.querySelectorAll('[data-extracted]');
    for (const el of extractedElements) {
      el.removeAttribute('data-extracted');
    }
    
    return content.trim();
    
  } catch (error) {
    console.error('Failed to extract text content:', error);
    return element.textContent || '';
  }
}

/**
 * Convert messages to markdown format
 * @param {Array<Object>} messages - Array of message objects
 * @param {string} channelName - Channel name
 * @param {Object} config - Configuration object
 * @returns {string} Markdown content
 */
function convertToMarkdown(messages, channelName, config) {
  const now = new Date();
  const exportTime = now.toLocaleString();
  
  let markdown = `# SlackSnap Export: ${channelName}\n`;
  markdown += `*Exported: ${exportTime}*\n\n`;
  markdown += `---\n\n`;
  
  for (const message of messages) {
    // Add sender and timestamp
    if (message.sender) {
      markdown += `**${window.SlackSnapUtils.escapeMarkdown(message.sender)}**`;
      
      if (config.includeTimestamps && message.timestamp) {
        console.log('🔍 Formatting timestamp:', message.timestamp, typeof message.timestamp);
        const formattedTime = formatTimestamp(message.timestamp);
        console.log('✅ Formatted result:', formattedTime);
        markdown += ` (${formattedTime})`;
      }
      
      markdown += `:\n`;
    }
    
    // Add message content
    if (message.content) {
      markdown += `${message.content}\n\n`;
    }
    
    // Add thread replies if enabled
    if (config.includeThreadReplies && message.threadReplies.length > 0) {
      markdown += `**Thread Replies:**\n`;
      for (const reply of message.threadReplies) {
        if (reply.sender) {
          markdown += `  • **${window.SlackSnapUtils.escapeMarkdown(reply.sender)}**: `;
        }
        if (reply.content) {
          markdown += `${reply.content}\n`;
        }
      }
      markdown += `\n`;
    }
  }
  
  return markdown;
}

/**
 * Format timestamp for display with date
 * @param {string} timestamp - Raw timestamp
 * @returns {string} Formatted timestamp with date
 */
function formatTimestamp(timestamp) {
  try {
    console.log('📅 formatTimestamp called with:', timestamp, 'type:', typeof timestamp);
    
    // Check if this is already a formatted string like "Wednesday 11:47 AM" or "Yesterday 05:00 AM"
    const timestampStr = String(timestamp);
    const hasRelativeDay = /(Today|Yesterday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i.test(timestampStr);
    if (hasRelativeDay) {
      console.error('❌ ERROR: Received pre-formatted timestamp string:', timestamp);
      console.error('❌ This should not happen - timestamps should be Unix timestamps from API');
      // We can't convert this back to a date, so return as-is for now
      return timestamp;
    }
    
    let date = null;
    
    // Handle API timestamps (ISO format from our conversion)
    if (timestamp && typeof timestamp === 'string' && timestamp.includes('T')) {
      date = new Date(timestamp);
      console.log('📅 Parsed as ISO:', date);
    }
    // Handle raw Unix timestamps from API (like "1753160757.123400" or "1753160757")
    // Also handle numeric timestamps
    else if (timestamp && (typeof timestamp === 'number' || /^\d{10}(\.\d+)?$/.test(String(timestamp)))) {
      const unixTimestamp = parseFloat(timestamp) * 1000; // Convert to milliseconds
      date = new Date(unixTimestamp);
      console.log('📅 Parsed as Unix timestamp:', timestamp, '->', date);
    }
    // Try parsing Slack's permalink timestamp formats
    else if (timestamp && String(timestamp).includes('p')) {
      const match = String(timestamp).match(/p(\d{10})\d*/);
      if (match) {
        const unixTimestamp = parseInt(match[1]) * 1000;
        date = new Date(unixTimestamp);
      }
    }
    // Try parsing as regular timestamp
    if (!date || isNaN(date.getTime())) {
      date = new Date(timestamp);
    }
    
    // If still can't parse, return error
    if (!date || isNaN(date.getTime())) {
      console.error('❌ Could not parse timestamp:', timestamp, typeof timestamp);
      return timestamp; // Return original if parsing fails
    }
    
    // Always show full date with year - use explicit formatting to avoid locale issues
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[date.getMonth()];
    const day = date.getDate();
    const year = date.getFullYear();
    
    let hours = date.getHours();
    const minutes = date.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12; // the hour '0' should be '12'
    const minutesStr = minutes < 10 ? '0' + minutes : minutes;
    
    const dateStr = `${month} ${day}, ${year}`;
    const timeStr = `${hours}:${minutesStr} ${ampm}`;
    
    console.log('📅 Formatted date:', dateStr, timeStr);
    
    return `${dateStr} ${timeStr}`;
  } catch (error) {
    console.error('Error formatting timestamp:', timestamp, error);
    return timestamp;
  }
}

/**
 * Get authentication token from Slack's localStorage
 */
function getSlackAuthToken() {
  try {
    const config = JSON.parse(localStorage.getItem('localConfig_v2') || '{}');
    
    if (!config.teams) {
      throw new Error('No Slack teams found in localStorage');
    }
    
    const teamId = Object.keys(config.teams)[0];
    const team = config.teams[teamId];
    
    if (!team || !team.token) {
      throw new Error('No authentication token found');
    }
    
    console.log('✅ Found Slack auth token for team:', teamId);
    return { token: team.token, teamId, team };
  } catch (error) {
    console.error('❌ Failed to get Slack auth token:', error);
    throw error;
  }
}

/**
 * Get current channel ID from URL or page context
 */
function getCurrentChannelId() {
  try {
    console.log('🔍 Detecting current channel ID...');
    console.log('📍 URL:', window.location.href);
    
    // Method 1: Extract from URL patterns
    const urlPatterns = [
      /\/messages\/([^\/\?]+)/,           // /messages/CHANNEL_ID
      /\/archives\/([^\/\?]+)/,           // /archives/CHANNEL_ID  
      /\/channels\/([^\/\?]+)/,           // /channels/CHANNEL_NAME
      /\/client\/[^\/]+\/([^\/\?]+)/,     // /client/TEAM/CHANNEL
    ];
    
    for (const pattern of urlPatterns) {
      const match = window.location.pathname.match(pattern);
      if (match) {
        const channelId = match[1];
        console.log('✅ Found channel ID from URL:', channelId);
        return channelId;
      }
    }
    
    // Method 2: Try to get from page context or localStorage
    // Slack often stores current channel in various places
    const config = JSON.parse(localStorage.getItem('localConfig_v2') || '{}');
    console.log('📋 Slack config keys:', Object.keys(config));
    
    // Fallback: return null and we'll handle it
    console.warn('⚠️ Could not determine channel ID');
    return null;
  } catch (error) {
    console.error('❌ Error getting channel ID:', error);
    return null;
  }
}

/**
 * Download files from Slack and save them locally
 * @param {Array<Object>} files - Array of file objects to download
 * @param {string} channelName - Channel name for directory structure
 * @param {string} token - Slack auth token
 * @param {Object} config - Configuration object
 * @returns {Promise<Object>} Map of file URL to local path
 */
async function downloadFiles(files, channelName, token, config) {
  const fileMap = {}; // Maps original URL to local path info
  const filesDir = `${config.downloadDirectory || 'slack-exports'}/${channelName}_files`;
  
  if (files.length === 0) {
    console.log('📁 No files to download');
    return fileMap;
  }
  
  console.log(`📥 Downloading ${files.length} files to ${filesDir}/...`);
  
  // Remove duplicates based on URL
  const uniqueFiles = [];
  const seenUrls = new Set();
  for (const file of files) {
    if (!seenUrls.has(file.url)) {
      seenUrls.add(file.url);
      uniqueFiles.push(file);
    }
  }
  
  console.log(`📦 Found ${uniqueFiles.length} unique files to download`);
  
  // Download files sequentially with delays to avoid rate limiting
  // Slack has strict rate limits, so we'll download one at a time with delays
  for (let i = 0; i < uniqueFiles.length; i++) {
    const file = uniqueFiles[i];
    
    // Add delay between file downloads (except for first file)
    if (i > 0) {
      await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay between files
    }
    
    try {
      const localPath = await downloadSingleFile(file, filesDir, token);
      if (localPath) {
        fileMap[file.url] = {
          localPath: localPath,
          localName: file.name,
          file: file
        };
        // Also update the file object for later reference
        file.localPath = localPath;
        file.localName = file.name;
      }
    } catch (error) {
      console.warn(`⚠️ Failed to download file ${file.name}:`, error);
      // Keep original URL as fallback
      fileMap[file.url] = {
        localPath: file.url, // Fallback to original URL
        localName: file.name,
        file: file,
        error: true
      };
    }
  }
  
  console.log(`✅ Downloaded ${Object.keys(fileMap).length} files`);
  return fileMap;
}

/**
 * Download a single file from Slack (via background script to avoid CORS)
 * @param {Object} file - File object with id, url, name, mimetype
 * @param {string} filesDir - Directory to save file in
 * @param {string} token - Slack auth token
 * @param {number} retryCount - Current retry attempt (internal use)
 * @returns {Promise<string>} Local file path relative to download directory
 */
async function downloadSingleFile(file, filesDir, token, retryCount = 0) {
  const maxRetries = 2;
  
  try {
    // Sanitize filename
    const sanitizedName = sanitizeFileName(file.name);
    const localPath = `${filesDir}/${sanitizedName}`;
    
    console.log(`⬇️ Downloading: ${file.name} -> ${localPath}${retryCount > 0 ? ` (retry ${retryCount}/${maxRetries})` : ''}`);
    
    // Send download request to background script (which can bypass CORS)
    // Include file ID for fallback URL refresh if direct URL fails
    const downloadResponse = await chrome.runtime.sendMessage({
      action: 'DOWNLOAD_SLACK_FILE',
      data: {
        fileId: file.id || null, // Include file ID for fallback URL refresh
        fileUrl: file.url, // Use direct URL
        filename: localPath,
        mimetype: file.mimetype || 'application/octet-stream',
        token: token
      }
    });
    
    if (!downloadResponse || !downloadResponse.success) {
      const error = downloadResponse?.error || 'Download failed';
      
      // Retry logic for 401 errors or failed fetches
      if ((error.includes('401') || error.includes('Failed to fetch')) && retryCount < maxRetries) {
        console.log(`🔄 Retrying ${file.name} (attempt ${retryCount + 1}/${maxRetries})...`);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait before retry
        return downloadSingleFile(file, filesDir, token, retryCount + 1);
      }
      
      throw new Error(error);
    }
    
    return localPath;
  } catch (error) {
    // If it's a retryable error and we haven't exhausted retries, try again
    if ((error.message.includes('401') || error.message.includes('Failed to fetch')) && retryCount < maxRetries) {
      console.log(`🔄 Retrying download of ${file.name}...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      return downloadSingleFile(file, filesDir, token, retryCount + 1);
    }
    
    console.error(`❌ Error downloading file ${file.name}:`, error);
    throw error;
  }
}

/**
 * Convert ArrayBuffer to base64 string
 * @param {ArrayBuffer} buffer - ArrayBuffer to convert
 * @returns {string} Base64 encoded string
 */
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Sanitize filename for filesystem
 * @param {string} filename - Original filename
 * @returns {string} Sanitized filename
 */
function sanitizeFileName(filename) {
  if (!filename) return `file-${Date.now()}`;
  
  // Remove path separators and other dangerous characters
  let sanitized = filename
    .replace(/[\/\\\?\*\|"<>:]/g, '_')
    .replace(/\s+/g, '_')
    .substring(0, 200); // Limit length
  
  // Ensure it has an extension
  if (!sanitized.includes('.')) {
    sanitized += '.bin';
  }
  
  return sanitized;
}

/**
 * Update file references in messages to use local paths
 * @param {Array<Object>} messages - Array of message objects
 * @param {Object} fileMap - Map of file URLs to local paths
 * @param {string} baseDirectory - Base directory to strip from paths (e.g., 'slack-exports')
 */
function updateFileReferencesInMessages(messages, fileMap, baseDirectory = 'slack-exports') {
  // Helper function to strip base directory from path
  const stripBaseDirectory = (path) => {
    if (!path) return path;
    // Remove base directory prefix if present
    const basePrefix = baseDirectory + '/';
    if (path.startsWith(basePrefix)) {
      return path.substring(basePrefix.length);
    }
    return path;
  };

  for (const message of messages) {
    // Update content using stored messageFiles
    if (message.messageFiles && message.messageFiles.length > 0) {
      let updatedContent = message.content;
      
      for (const file of message.messageFiles) {
        const fileInfo = fileMap[file.url];
        if (fileInfo && fileInfo.localPath && !fileInfo.error) {
          // Strip base directory from local path for markdown links
          const relativePath = stripBaseDirectory(fileInfo.localPath);
          
          // Replace file URL references with relative path (without base directory)
          const fileUrlPattern = new RegExp(escapeRegex(file.url), 'g');
          updatedContent = updatedContent.replace(fileUrlPattern, relativePath);
          
          // Also replace any markdown links that reference this file
          const linkPattern = new RegExp(`\\[([^\\]]+)\\]\\(${escapeRegex(file.url)}\\)`, 'g');
          updatedContent = updatedContent.replace(linkPattern, `[$1](${relativePath})`);
          
          // For images, update image markdown syntax
          if (file.image) {
            const imagePattern = new RegExp(`!\\[([^\\]]*)\\]\\(${escapeRegex(file.url)}\\)`, 'g');
            updatedContent = updatedContent.replace(imagePattern, `![$1](${relativePath})`);
          }
        }
      }
      
      message.content = updatedContent;
    }
    
    // Update thread replies
    if (message.threadReplies) {
      for (const reply of message.threadReplies) {
        if (reply.messageFiles && reply.messageFiles.length > 0) {
          let updatedReplyContent = reply.content;
          
          for (const file of reply.messageFiles) {
            const fileInfo = fileMap[file.url];
            if (fileInfo && fileInfo.localPath && !fileInfo.error) {
              // Strip base directory from local path for markdown links
              const relativePath = stripBaseDirectory(fileInfo.localPath);
              const fileUrlPattern = new RegExp(escapeRegex(file.url), 'g');
              updatedReplyContent = updatedReplyContent.replace(fileUrlPattern, relativePath);
            }
          }
          
          reply.content = updatedReplyContent;
        }
      }
    }
  }
}

/**
 * Escape special regex characters in a string
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Export a specific channel via API (parameterized version for batch export)
 * @param {string} channelId - The Slack channel ID to export
 * @param {string} channelName - Human-readable channel name (used in markdown header)
 * @param {number|null} oldestTimestamp - If provided, fetch messages since this Unix ms timestamp; otherwise use historyDays
 * @returns {Promise<Object>} Result with messageCount, markdown, channelName
 */
async function exportChannelViaAPI(channelId, channelName, oldestTimestamp = null) {
  const config = await getConfig();
  const { token } = getSlackAuthToken();

  const oldestUnix = oldestTimestamp
    ? Math.floor(oldestTimestamp / 1000)
    : Math.floor((Date.now() - (config.historyDays || 7) * 86400 * 1000) / 1000);

  console.log(`📆 Export window for ${channelName}: since ${new Date(oldestUnix * 1000).toISOString()}`);
  const apiMessages = await getMessagesViaHistoryAPI(channelId, oldestUnix, token);

  if (!apiMessages || apiMessages.length === 0) {
    console.log(`ℹ️ No messages found for ${channelName} in the selected date range.`);
    return { messageCount: 0, markdown: '', channelName };
  }

  // Extract unique user IDs from messages and cache thread replies
  const userIds = new Set();
  const threadRepliesCache = new Map(); // Cache thread replies to avoid fetching twice
  let threadFetchCount = 0;
  
  for (let i = 0; i < apiMessages.length; i++) {
    const msg = apiMessages[i];
    if (msg.user) userIds.add(msg.user);
    const mentionMatches = (msg.text || '').match(/<@([A-Z0-9]+)>/g);
    if (mentionMatches) {
      mentionMatches.forEach(match => {
        const userId = match.match(/<@([A-Z0-9]+)>/)[1];
        userIds.add(userId);
      });
    }
    if (config.includeThreadReplies && msg.thread_ts && msg.reply_count > 0) {
      // Add delay between thread reply fetches to avoid rate limiting
      if (threadFetchCount > 0) {
        await new Promise(resolve => setTimeout(resolve, 800)); // 800ms delay between thread fetches
      }
      threadFetchCount++;
      
      const repliesRaw = await fetchThreadReplies(channelId, msg.thread_ts, oldestUnix, token);
      // Cache thread replies for later use
      threadRepliesCache.set(msg.thread_ts, repliesRaw);
      
      for (const reply of repliesRaw) {
        if (reply.user) userIds.add(reply.user);
        const replyMentions = (reply.text || '').match(/<@([A-Z0-9]+)>/g);
        if (replyMentions) {
          replyMentions.forEach(match => {
            const userId = match.match(/<@([A-Z0-9]+)>/)[1];
            userIds.add(userId);
          });
        }
      }
    }
  }

  console.log(`🎯 Need to fetch ${userIds.size} users for ${channelName}`);
  const userMap = await fetchSpecificUsers(Array.from(userIds), token);

  // Enrich messages with usernames and thread replies, and collect files
  const enrichedMessages = [];
  const filesToDownload = []; // Track all files that need to be downloaded
  let emptyContentCount = 0;
  for (const apiMsg of apiMessages) {
    // Handle sender extraction - system messages might not have a user field
    let sender = 'Unknown User';
    if (apiMsg.user) {
      sender = userMap[apiMsg.user] || 'Unknown User';
    } else if (apiMsg.subtype === 'bot_message' && apiMsg.bot_id) {
      sender = apiMsg.username || 'Bot';
    } else if (apiMsg.subtype) {
      // System messages - use a descriptive label
      sender = 'System';
    }
    
    // Collect files from this message
    const messageFiles = collectFilesFromMessage(apiMsg);
    filesToDownload.push(...messageFiles);
    
    // Store file references in message for later update
    let content = extractMessageContent(apiMsg, userMap, messageFiles);
    
    // Debug: Log messages with empty content to understand what's being filtered
    if (!content || !content.trim()) {
      emptyContentCount++;
      if (emptyContentCount <= 10) { // Log first 10 empty messages
        console.log(`🔍 Empty content for message:`, {
          ts: apiMsg.ts,
          user: apiMsg.user,
          subtype: apiMsg.subtype,
          hasText: !!apiMsg.text,
          textValue: apiMsg.text, // Show actual value, not just boolean
          textLength: apiMsg.text ? apiMsg.text.length : 0,
          textPreview: apiMsg.text ? apiMsg.text.substring(0, 100) : 'none',
          hasFiles: !!(apiMsg.files && apiMsg.files.length > 0),
          fileCount: apiMsg.files ? apiMsg.files.length : 0,
          hasBlocks: !!(apiMsg.blocks && apiMsg.blocks.length > 0),
          blockCount: apiMsg.blocks ? apiMsg.blocks.length : 0,
          sender: sender,
          extractedContent: content,
          extractedContentLength: content ? content.length : 0
        });
        // Also log the full message for first few to see structure
        if (emptyContentCount <= 3) {
          console.log(`📋 Full message object (first ${emptyContentCount}):`, JSON.stringify(apiMsg, null, 2));
        }
      }
    }

    const threadReplies = [];
    if (config.includeThreadReplies && apiMsg.thread_ts && apiMsg.reply_count > 0) {
      // Use cached thread replies to avoid fetching twice
      const repliesRaw = threadRepliesCache.get(apiMsg.thread_ts) || [];
      for (const reply of repliesRaw) {
        if (reply.ts === apiMsg.thread_ts) continue;
        const replySender = userMap[reply.user] || 'Unknown User';
        const replyFiles = collectFilesFromMessage(reply);
        filesToDownload.push(...replyFiles);
        let replyContent = extractMessageContent(reply, userMap, replyFiles);
        threadReplies.push({ 
          sender: replySender, 
          content: replyContent, 
          timestamp: reply.ts,
          messageFiles: replyFiles // Store file references for later update
        });
      }
    }

    enrichedMessages.push({ 
      sender, 
      content, 
      timestamp: apiMsg.ts, 
      threadReplies,
      messageFiles: messageFiles // Store file references for later update
    });
  }
  
  console.log(`📊 Enrichment complete: ${enrichedMessages.length} total, ${emptyContentCount} with empty content`);

  // Debug: Log messages that will be filtered out
  const filteredOut = enrichedMessages.filter(msg => !msg.content || !msg.content.trim());
  if (filteredOut.length > 0) {
    console.log(`⚠️ Filtering out ${filteredOut.length} messages without content`);
    // Log sample of filtered messages for debugging
    const sample = filteredOut.slice(0, 5);
    sample.forEach((msg, i) => {
      console.log(`  Filtered ${i + 1}: sender="${msg.sender}", timestamp="${msg.timestamp}", content="${msg.content}"`);
    });
  }
  
  const messages = enrichedMessages
    .filter(msg => msg.content && msg.content.trim())
    .sort((a, b) => parseFloat(a.timestamp) - parseFloat(b.timestamp));

  // Download files before generating markdown
  const fileMap = await downloadFiles(filesToDownload, channelName, token, config);
  
  // Update file references in messages to use local paths (strip base directory)
  const baseDirectory = config.downloadDirectory || 'slack-exports';
  updateFileReferencesInMessages(messages, fileMap, baseDirectory);

  const markdown = convertToMarkdown(messages, channelName, config);
  
  // Ensure markdown is always a string
  if (!markdown || typeof markdown !== 'string') {
    console.error(`❌ Markdown generation failed for ${channelName} - got:`, typeof markdown, markdown);
    throw new Error(`Failed to generate markdown for ${channelName}`);
  }
  
  console.log(`✅ Processed ${messages.length} messages for ${channelName} (markdown: ${markdown.length} chars)`);

  return { messageCount: messages.length, markdown, channelName };
}

/**
 * Export messages using Slack's API for maximum reliability and efficiency
 * (Single-channel export triggered by the legacy EXPORT_MESSAGES action)
 */
async function exportMessagesViaAPI() {
  try {
    console.log('🚀 Starting robust API-based message export...');
    const config = await getConfig();
    window.SlackSnapUtils.showNotification('Getting messages via API...', 'success');

    const channelId = getCurrentChannelId();
    if (!channelId) throw new Error('Could not determine channel ID');
    const channelName = window.SlackSnapUtils.extractChannelName();

    const result = await exportChannelViaAPI(channelId, channelName);

    if (result.messageCount === 0) {
      window.SlackSnapUtils.showNotification('No messages found in the selected date range.', 'success');
      return;
    }

    const filename = window.SlackSnapUtils.generateFilename(channelName, config);

    chrome.runtime.sendMessage({
      action: 'DOWNLOAD_FILE',
      data: { filename, content: result.markdown, directory: config.downloadDirectory }
    }, (res) => {
      if (res && res.success) {
        window.SlackSnapUtils.showNotification(`✅ Exported ${result.messageCount} messages to ${filename}`, 'success');
      } else {
        window.SlackSnapUtils.showNotification(`❌ Download failed: ${res?.error || 'Unknown error'}`, 'error');
      }
    });

  } catch (error) {
    console.error('❌ API export failed:', error);
    window.SlackSnapUtils.showNotification(`❌ Export failed: ${error.message}`, 'error');
  }
}

/**
 * Fetch specific users by their IDs (much more efficient!)
 * @param {Array<string>} userIds - Array of user IDs to fetch
 * @param {string} token - Slack auth token
 * @returns {Promise<Object>} Map of user ID to display name
 */
async function fetchSpecificUsers(userIds, token) {
  try {
    console.log(`👥 Fetching ${userIds.length} specific users...`);
    const userMap = {};
    
    // Try to get users from conversations.members first (channel members)
    try {
      const channelId = getCurrentChannelId();
      const channelMembers = await fetchChannelMembers(channelId, token);
      console.log(`📋 Found ${channelMembers.length} channel members`);
      
      // Build map from channel members
      for (const member of channelMembers) {
        if (userIds.includes(member.id)) {
          const displayName = member.real_name || 
                             member.profile?.display_name || 
                             member.profile?.real_name || 
                             member.name || 
                             'Unknown User';
          userMap[member.id] = displayName;
        }
      }
    } catch (error) {
      console.warn('⚠️ Could not fetch channel members, will use users.info instead');
    }
    
    // For any remaining users not found in channel members, fetch individually
    const remainingUserIds = userIds.filter(id => !userMap[id]);
    console.log(`🔍 Need to fetch ${remainingUserIds.length} users individually`);
    
    // Batch fetch users in groups of 10 to avoid rate limits
    const batchSize = 10;
    for (let i = 0; i < remainingUserIds.length; i += batchSize) {
      const batch = remainingUserIds.slice(i, i + batchSize);
      
      for (const userId of batch) {
        try {
          const user = await fetchSingleUser(userId, token);
          if (user) {
            const displayName = user.real_name || 
                               user.profile?.display_name || 
                               user.profile?.real_name || 
                               user.name || 
                               'Unknown User';
            userMap[userId] = displayName;
          }
          
          // Small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
          console.warn(`⚠️ Could not fetch user ${userId}:`, error);
          userMap[userId] = 'Unknown User';
        }
      }
      
      // Longer delay between batches
      if (i + batchSize < remainingUserIds.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    console.log(`✅ Resolved ${Object.keys(userMap).length} users`);
    return userMap;
  } catch (error) {
    console.error('❌ Failed to fetch specific users:', error);
    // Return empty map so export can continue with "Unknown User"
    return {};
  }
}

/**
 * Fetch channel members (much faster than all users)
 * @param {string} channelId - Channel ID
 * @param {string} token - Slack auth token
 * @returns {Promise<Array>} Array of user objects who are members of this channel
 */
async function fetchChannelMembers(channelId, token) {
  try {
    console.log(`📋 Trying to fetch channel members for ${channelId}...`);
    
    const params = new URLSearchParams({
      token: token,
      channel: channelId,
      limit: '1000'
    });
    
    const response = await fetch('/api/conversations.members', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Slack-No-Retry': '1'
      },
      body: params.toString()
    });
    
    const data = await response.json();
    if (!data.ok) {
      console.log(`📋 Channel members not available (${data.error}), will fetch users individually`);
      return [];
    }
    
    const memberIds = data.members || [];
    console.log(`📋 Found ${memberIds.length} channel member IDs`);
    
    // For channel members, we still need their profile info
    // Just return empty array to skip this optimization and use individual fetching
    // (which is still very fast for small numbers of users)
    return [];
    
  } catch (error) {
    console.log(`📋 Channel members API not accessible, using individual user lookup`);
    return [];
  }
}

/**
 * Fetch a single user by ID
 * @param {string} userId - User ID
 * @param {string} token - Slack auth token
 * @returns {Promise<Object|null>} User object or null
 */
async function fetchSingleUser(userId, token) {
  const params = new URLSearchParams({
    token: token,
    user: userId
  });
  
  const response = await fetch('/api/users.info', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Slack-No-Retry': '1'
    },
    body: params.toString()
  });
  
  const data = await response.json();
  if (!data.ok) {
    throw new Error(`users.info API failed: ${data.error}`);
  }
  
  return data.user;
}

/**
 * Collect file attachments from a Slack message
 * @param {Object} apiMsg - Slack API message object
 * @returns {Array<Object>} Array of file objects with id, name, url, mimetype, etc.
 */
function collectFilesFromMessage(apiMsg) {
  const files = [];
  
  // Collect files from apiMsg.files array
  if (apiMsg.files && Array.isArray(apiMsg.files)) {
    for (const file of apiMsg.files) {
      if (file.id || file.url_private || file.permalink) {
        files.push({
          id: file.id, // Store file ID for API downloads
          name: file.name || file.title || `file-${file.id || Date.now()}`,
          url: file.url_private || file.permalink, // Fallback URL
          mimetype: file.mimetype || 'application/octet-stream',
          size: file.size,
          thumb_64: file.thumb_64,
          thumb_360: file.thumb_360,
          image: file.mimetype && file.mimetype.startsWith('image/'),
          original: file
        });
      }
    }
  }
  
  // Collect files from apiMsg.file (single file share)
  if (apiMsg.file && !apiMsg.files) {
    const file = apiMsg.file;
    if (file.id || file.url_private || file.permalink) {
      files.push({
        id: file.id, // Store file ID for API downloads
        name: file.name || file.title || `file-${file.id || Date.now()}`,
        url: file.url_private || file.permalink, // Fallback URL
        mimetype: file.mimetype || 'application/octet-stream',
        size: file.size,
        thumb_64: file.thumb_64,
        thumb_360: file.thumb_360,
        image: file.mimetype && file.mimetype.startsWith('image/'),
        original: file
      });
    }
  }
  
  // Extract images from blocks (embedded/pasted images)
  if (apiMsg.blocks && Array.isArray(apiMsg.blocks)) {
    for (const block of apiMsg.blocks) {
      // Check for image blocks
      if (block.type === 'image' && block.image_url) {
        files.push({
          id: block.image_url,
          name: block.alt_text || `image-${Date.now()}.png`,
          url: block.image_url,
          mimetype: 'image/png', // Default for embedded images
          image: true,
          embedded: true,
          original: block
        });
      }
      
      // Check for image elements in rich text blocks
      if (block.elements && Array.isArray(block.elements)) {
        for (const element of block.elements) {
          if (element.type === 'image' && element.image_url) {
            files.push({
              id: element.image_url,
              name: element.alt_text || `image-${Date.now()}.png`,
              url: element.image_url,
              mimetype: 'image/png',
              image: true,
              embedded: true,
              original: element
            });
          }
        }
      }
    }
  }
  
  return files;
}

/**
 * Extract all content from a Slack message (text, files, blocks, etc.)
 * @param {Object} apiMsg - Slack API message object
 * @param {Object} userMap - Map of user IDs to display names
 * @param {Array<Object>} messageFiles - Array of file objects collected from this message
 * @returns {string} Combined content string
 */
function extractMessageContent(apiMsg, userMap, messageFiles = []) {
  const parts = [];
  
  // Extract main text content - be more permissive, extract if text exists at all
  // Slack API can return text as string, null, or undefined
  if (apiMsg.text !== undefined && apiMsg.text !== null && apiMsg.text !== '') {
    try {
      let text = String(apiMsg.text);
      // Clean the text
      text = window.SlackSnapUtils.cleanText(text);
      // Replace user mentions
      text = text.replace(/<@([A-Z0-9]+)>/g, (_, id) => '@' + (userMap[id] || 'unknown'));
      // Include text if it has any content after cleaning
      if (text && text.length > 0) {
        parts.push(text);
      }
    } catch (error) {
      console.warn('⚠️ Error extracting text content:', error, 'for message:', apiMsg.ts);
      // If cleaning fails, try to use raw text
      if (apiMsg.text && String(apiMsg.text).trim().length > 0) {
        parts.push(String(apiMsg.text));
      }
    }
  }
  
  // Extract file attachments - use URLs initially, will be replaced with local paths after download
  if (messageFiles && messageFiles.length > 0) {
    const fileParts = [];
    for (const file of messageFiles) {
      const fileName = file.name || 'Unnamed file';
      const filePath = file.url || ''; // Use URL initially, will be replaced later
      
      if (file.image) {
        // For images, embed them in markdown (will be updated to local path)
        fileParts.push(`![${fileName}](${filePath})`);
      } else if (filePath) {
        // For other files, use link (will be updated to local path)
        fileParts.push(`[${fileName}](${filePath})`);
      } else {
        fileParts.push(fileName);
      }
      
      // Add file type info if available
      if (file.mimetype && !file.image) {
        fileParts[fileParts.length - 1] += ` (${file.mimetype})`;
      }
    }
    if (fileParts.length > 0) {
      parts.push(`📎 Files: ${fileParts.join(', ')}`);
    }
  }
  
  // Extract blocks content (rich text blocks)
  if (apiMsg.blocks && Array.isArray(apiMsg.blocks)) {
    for (const block of apiMsg.blocks) {
      if (block.type === 'rich_text' && block.elements) {
        const blockText = extractBlockText(block.elements, userMap);
        if (blockText.trim()) {
          parts.push(blockText);
        }
      } else if (block.text && block.text.text) {
        let blockText = window.SlackSnapUtils.cleanText(block.text.text);
        blockText = blockText.replace(/<@([A-Z0-9]+)>/g, (_, id) => '@' + (userMap[id] || 'unknown'));
        if (blockText.trim()) {
          parts.push(blockText);
        }
      }
    }
  }
  
  // Handle system messages and subtypes
  if (apiMsg.subtype) {
    if (apiMsg.subtype === 'file_share' && apiMsg.file) {
      const fileName = apiMsg.file.name || apiMsg.file.title || 'Unnamed file';
      parts.push(`📎 Shared file: ${fileName}`);
    } else if (apiMsg.subtype === 'channel_join') {
      parts.push('joined the channel');
    } else if (apiMsg.subtype === 'channel_leave') {
      parts.push('left the channel');
    } else if (apiMsg.subtype === 'channel_topic') {
      parts.push(`📌 Topic: ${apiMsg.topic || ''}`);
    } else if (apiMsg.subtype === 'channel_purpose') {
      parts.push(`📌 Purpose: ${apiMsg.purpose || ''}`);
    } else if (apiMsg.subtype === 'pinned_item') {
      parts.push('📌 Pinned a message');
    } else if (apiMsg.subtype === 'file_comment') {
      parts.push(`💬 Comment on file: ${apiMsg.comment?.comment || ''}`);
    }
  }
  
  // If no content found but message exists, indicate it's a message without visible content
  if (parts.length === 0) {
    // Check if it's a deleted message
    if (apiMsg.subtype === 'message_deleted') {
      return '[Message deleted]';
    }
    // For other cases, return empty string (will be filtered out)
    return '';
  }
  
  return parts.join('\n\n');
}

/**
 * Extract text from Slack block elements recursively
 * @param {Array} elements - Block elements array
 * @param {Object} userMap - Map of user IDs to display names
 * @returns {string} Extracted text
 */
function extractBlockText(elements, userMap) {
  if (!Array.isArray(elements)) return '';
  
  const parts = [];
  for (const element of elements) {
    if (element.type === 'text' && element.text) {
      let text = window.SlackSnapUtils.cleanText(element.text);
      text = text.replace(/<@([A-Z0-9]+)>/g, (_, id) => '@' + (userMap[id] || 'unknown'));
      parts.push(text);
    } else if (element.type === 'rich_text_section' && element.elements) {
      parts.push(extractBlockText(element.elements, userMap));
    } else if (element.type === 'rich_text_list' && element.elements) {
      for (const item of element.elements) {
        if (item.elements) {
          parts.push(`• ${extractBlockText(item.elements, userMap)}`);
        }
      }
    } else if (element.type === 'rich_text_quote' && element.elements) {
      parts.push(`> ${extractBlockText(element.elements, userMap)}`);
    } else if (element.type === 'rich_text_preformatted' && element.elements) {
      const code = extractBlockText(element.elements, userMap);
      parts.push(`\`\`\`\n${code}\n\`\`\``);
    } else if (element.type === 'link' && element.url) {
      const linkText = element.text || element.url;
      parts.push(`[${linkText}](${element.url})`);
    } else if (element.text) {
      let text = window.SlackSnapUtils.cleanText(element.text);
      text = text.replace(/<@([A-Z0-9]+)>/g, (_, id) => '@' + (userMap[id] || 'unknown'));
      parts.push(text);
    }
  }
  
  return parts.join('');
}

/**
 * Fetch messages from a channel using conversations.history API
 * @param {string} channelId - Channel ID
 * @param {number} oldestUnix - Oldest timestamp to fetch (Unix timestamp)
 * @param {string} token - Slack auth token
 * @returns {Promise<Array>} Array of message objects
 */
async function getMessagesViaHistoryAPI(channelId, oldestUnix, token) {
  try {
    console.log(`📥 Fetching messages for channel ${channelId} since ${new Date(oldestUnix * 1000).toISOString()}`);
    
    let allMessages = [];
    let cursor = '';
    let hasMore = true;
    let pageCount = 0;
    
    while (hasMore) {
      pageCount++;
      
      // Add delay between requests to avoid rate limiting (except for first request)
      if (pageCount > 1) {
        console.log('⏱️ Waiting 1 second to avoid rate limiting...');
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      const params = new URLSearchParams({
        token: token,
        channel: channelId,
        limit: '100', // Reduced from 200 to be more gentle
        oldest: oldestUnix.toString(),
        inclusive: 'true'
      });
      
      if (cursor) {
        params.append('cursor', cursor);
      }
      
      // Retry logic for rate limiting
      let retryCount = 0;
      let success = false;
      
      while (!success && retryCount < 3) {
        try {
          const response = await fetch('/api/conversations.history', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'X-Slack-No-Retry': '1'
            },
            body: params.toString()
          });
          
          const data = await response.json();
          
          if (!data.ok) {
            if (data.error === 'ratelimited') {
              retryCount++;
              const waitTime = Math.pow(2, retryCount) * 2000; // Exponential backoff
              console.log(`⏳ Rate limited on message page ${pageCount}, waiting ${waitTime/1000}s before retry ${retryCount}/3...`);
              await new Promise(resolve => setTimeout(resolve, waitTime));
              continue;
            } else {
              throw new Error(`conversations.history API failed: ${data.error}`);
            }
          }
          
          const pageMessages = data.messages || [];
          allMessages = allMessages.concat(pageMessages);
          hasMore = data.has_more;
          cursor = data.response_metadata?.next_cursor || '';
          
          console.log(`📨 Page ${pageCount}: Fetched ${pageMessages.length} messages (total: ${allMessages.length})`);
          success = true;
          
        } catch (fetchError) {
          retryCount++;
          if (retryCount >= 3) {
            throw fetchError;
          }
          const waitTime = Math.pow(2, retryCount) * 1000;
          console.log(`🔄 Message fetch error on page ${pageCount}, retrying in ${waitTime/1000}s... (${retryCount}/3)`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
      
      if (!success) {
        throw new Error(`Failed to fetch message page ${pageCount} after 3 retries`);
      }
    }
    
    console.log(`✅ Total messages fetched: ${allMessages.length} across ${pageCount} pages`);
    return allMessages;
  } catch (error) {
    console.error('❌ Failed to fetch messages:', error);
    throw error;
  }
}

/**
 * Fetch thread replies for a message with retry logic and rate limiting
 * @param {string} channelId - Channel ID
 * @param {string} threadTs - Thread timestamp
 * @param {number} oldestUnix - Oldest timestamp to fetch
 * @param {string} token - Slack auth token
 * @param {number} retryCount - Current retry attempt (internal use)
 * @returns {Promise<Array>} Array of reply message objects
 */
async function fetchThreadReplies(channelId, threadTs, oldestUnix, token, retryCount = 0) {
  const maxRetries = 3;
  
  try {
    console.log(`🧵 Fetching thread replies for ${threadTs}${retryCount > 0 ? ` (retry ${retryCount}/${maxRetries})` : ''}`);
    
    const params = new URLSearchParams({
      token: token,
      channel: channelId,
      ts: threadTs,
      limit: '200',
      oldest: oldestUnix.toString()
    });
    
    const response = await fetch('/api/conversations.replies', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Slack-No-Retry': '1'
      },
      body: params.toString()
    });
    
    const data = await response.json();
    
    if (!data.ok) {
      // Handle rate limiting with exponential backoff
      if (data.error === 'ratelimited' && retryCount < maxRetries) {
        const retryAfter = data.response_metadata?.retry_after || Math.pow(2, retryCount) * 2;
        console.log(`⏳ Rate limited, waiting ${retryAfter}s before retry ${retryCount + 1}/${maxRetries}...`);
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
        return fetchThreadReplies(channelId, threadTs, oldestUnix, token, retryCount + 1);
      }
      throw new Error(`conversations.replies API failed: ${data.error}`);
    }
    
    console.log(`✅ Found ${data.messages?.length || 0} thread replies`);
    return data.messages || [];
  } catch (error) {
    // If it's a rate limit error and we haven't exhausted retries, try again
    if (error.message.includes('ratelimited') && retryCount < maxRetries) {
      const waitTime = Math.pow(2, retryCount) * 2;
      console.log(`⏳ Rate limit error, waiting ${waitTime}s before retry ${retryCount + 1}/${maxRetries}...`);
      await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
      return fetchThreadReplies(channelId, threadTs, oldestUnix, token, retryCount + 1);
    }
    
    console.error('❌ Failed to fetch thread replies:', error);
    return []; // Return empty array on error to avoid breaking the export
  }
}

console.log('🚀 SlackSnap content script loaded - VERSION 2.0 (with full timestamp fix)');
console.log('📍 Current page:', window.location.href);
console.log('📄 Page title:', document.title);

// Check if dependencies are loaded
console.log('🔍 Checking dependencies...');
console.log('- getConfig available:', typeof getConfig !== 'undefined');
console.log('- SlackSnapUtils available:', typeof window.SlackSnapUtils !== 'undefined');

// Notify background script that content script is ready
try {
  chrome.runtime.sendMessage({ action: 'CONTENT_SCRIPT_READY' });
  console.log('📡 Notified background script that content script is ready');
} catch (error) {
  console.warn('⚠️ Could not notify background script:', error.message);
}

// Development and troubleshooting utilities
window.slackSnapDebug = {
  // Test basic DOM message extraction
  testExtraction: () => extractVisibleMessages(),
  
  // Test DOM-based export (fallback method)  
  testDOMExport: () => exportMessages().catch(console.error),
  
  // Test API message extraction only
  testAPI: async () => {
    try {
      const channelId = getCurrentChannelId();
      const { token } = getSlackAuthToken();
      const messages = await getMessagesViaHistoryAPI(channelId, 50, token);
      return { success: true, messageCount: messages.length, channelId };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
  
  // Test Slack authentication
  testAuth: () => {
    try {
      const { teamId, token } = getSlackAuthToken();
      return { success: true, teamId, hasToken: !!token };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
  
  // Test full API export (main functionality)
  testAPIExport: () => exportMessagesViaAPI().catch(console.error)
};

// Debug functions: window.slackSnapDebug.testAuth(), .testAPI(), .testAPIExport(), .testExtraction(), .testDOMExport()