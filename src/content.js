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
        const formattedTime = formatTimestamp(message.timestamp);
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
    // Lightweight parsing without verbose per-timestamp logs
    
    let date = null;
    
    // Handle API timestamps (ISO format from our conversion)
    if (timestamp && typeof timestamp === 'string' && timestamp.includes('T')) {
      date = new Date(timestamp);
    }
    // Handle raw Unix timestamps from API (like "1753160757.123400")
    else if (timestamp && /^\d{10}(\.\d{6})?$/.test(timestamp)) {
      const unixTimestamp = parseFloat(timestamp) * 1000; // Convert to milliseconds
      date = new Date(unixTimestamp);
    }
    // Try parsing Slack's permalink timestamp formats
    else if (timestamp && timestamp.includes('p17')) {
      const match = timestamp.match(/p(\d{10})\d*/);
      if (match) {
        const unixTimestamp = parseInt(match[1]) * 1000;
        date = new Date(unixTimestamp);
      }
    }
    // Try parsing as regular timestamp
    else if (!date || isNaN(date.getTime())) {
      date = new Date(timestamp);
    }
    
    // Try parsing various formats if still failing
    if (!date || isNaN(date.getTime())) {
      // For time-only formats like "5:05 PM", we can't assume the date
      // Just return the original timestamp since we don't know when it was sent
      const timeMatch = timestamp.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
      if (timeMatch) {
        console.log('⚠️ Found time-only format without date context:', timestamp);
        return timestamp; // Return as-is since we can't determine the actual date
      }
    }
    
    if (!date || isNaN(date.getTime())) {
      console.warn('⚠️ Could not parse timestamp:', timestamp);
      return timestamp; // Return original if parsing fails
    }
    
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const messageDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    
    // Calculate days difference
    const diffTime = today.getTime() - messageDate.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    
    let dateStr = '';
    if (diffDays === 0) {
      dateStr = 'Today';
    } else if (diffDays === 1) {
      dateStr = 'Yesterday';
    } else if (diffDays < 7) {
      dateStr = date.toLocaleDateString([], { weekday: 'long' });
    } else {
      dateStr = date.toLocaleDateString([], { 
        month: 'short', 
        day: 'numeric',
        year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
      });
    }
    
    const timeStr = date.toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: true
    });
    
    return `${dateStr} ${timeStr}`;
  } catch (error) {
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
 * Export messages using Slack's API for maximum reliability and efficiency
 */
async function exportMessagesViaAPI() {
  try {
    console.log('🚀 Starting robust API-based message export...');
    const config = await getConfig();
    window.SlackSnapUtils.showNotification('Getting messages via API...', 'success');

    const { token } = getSlackAuthToken();
    const channelId = getCurrentChannelId();
    if (!channelId) throw new Error('Could not determine channel ID');
    
    // 1. Fetch messages first (this is fast)
    const historyDays = config.historyDays || 7;
    const oldestUnix = Math.floor((Date.now() - historyDays * 86400 * 1000) / 1000);
    console.log(`📆 Export window: last ${historyDays} days (since ${new Date(oldestUnix * 1000).toISOString()})`);
    const apiMessages = await getMessagesViaHistoryAPI(channelId, oldestUnix, token);

    if (!apiMessages || apiMessages.length === 0) {
      window.SlackSnapUtils.showNotification('No messages found in the selected date range.', 'success');
      return;
    }

    // 2. Extract unique user IDs from messages (much smarter!)
    const userIds = new Set();
    for (const msg of apiMessages) {
      if (msg.user) userIds.add(msg.user);
      
      // Also extract user IDs from @mentions in text
      const mentionMatches = (msg.text || '').match(/<@([A-Z0-9]+)>/g);
      if (mentionMatches) {
        mentionMatches.forEach(match => {
          const userId = match.match(/<@([A-Z0-9]+)>/)[1];
          userIds.add(userId);
        });
      }
      
      // If we're including thread replies, collect those user IDs too
      if (config.includeThreadReplies && msg.thread_ts && msg.reply_count > 0) {
        const repliesRaw = await fetchThreadReplies(channelId, msg.thread_ts, oldestUnix, token);
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
    
    console.log(`🎯 Smart approach: Only need to fetch ${userIds.size} users (instead of all workspace users)`);
    
    // 3. Fetch only the users we actually need
    const userMap = await fetchSpecificUsers(Array.from(userIds), token);

    // 4. Enrich messages with usernames and thread replies.
    const enrichedMessages = [];
    let unknownUsers = new Set();
    let resolvedUsers = new Set();
    
    for (const apiMsg of apiMessages) {
      const sender = userMap[apiMsg.user] || 'Unknown User';
      
      // Track user resolution for debugging
      if (sender === 'Unknown User') {
        unknownUsers.add(apiMsg.user);
      } else {
        resolvedUsers.add(apiMsg.user);
      }
      
      // Process message content with proper HTML entity decoding and @mention replacement
      let content = window.SlackSnapUtils.cleanText(apiMsg.text || '');
      content = content.replace(/<@([A-Z0-9]+)>/g, (_, id) => '@' + (userMap[id] || 'unknown'));

      const threadReplies = [];
      if (config.includeThreadReplies && apiMsg.thread_ts && apiMsg.reply_count > 0) {
        const repliesRaw = await fetchThreadReplies(channelId, apiMsg.thread_ts, oldestUnix, token);
        for (const reply of repliesRaw) {
          if (reply.ts === apiMsg.thread_ts) continue; // Skip parent message
          
          const replySender = userMap[reply.user] || 'Unknown User';
          if (replySender === 'Unknown User') {
            unknownUsers.add(reply.user);
          } else {
            resolvedUsers.add(reply.user);
          }
          
          // Process reply content with proper HTML entity decoding and @mention replacement
          let replyContent = window.SlackSnapUtils.cleanText(reply.text || '');
          replyContent = replyContent.replace(/<@([A-Z0-9]+)>/g, (_, id) => '@' + (userMap[id] || 'unknown'));
          
          threadReplies.push({
            sender: replySender,
            content: replyContent,
            timestamp: reply.ts,
          });
        }
      }

      enrichedMessages.push({
        sender,
        content,
        timestamp: apiMsg.ts,
        threadReplies,
      });
    }
    
    // Debug user resolution results
    console.log(`👥 User resolution summary:`);
    console.log(`  ✅ Resolved users: ${resolvedUsers.size}`);
    console.log(`  ❌ Unknown users: ${unknownUsers.size}`);
    
    if (unknownUsers.size > 0) {
      console.log(`🔍 Unknown user IDs: ${Array.from(unknownUsers).slice(0, 10).join(', ')}${unknownUsers.size > 10 ? '...' : ''}`);
    }
    
    if (resolvedUsers.size > 0) {
      console.log(`✅ Sample resolved users: ${Array.from(resolvedUsers).slice(0, 5).map(id => `${id}:${userMap[id]}`).join(', ')}`);
    }
    
    const messages = enrichedMessages
      .filter(msg => msg.content && msg.content.trim())
      .sort((a, b) => parseFloat(a.timestamp) - parseFloat(b.timestamp));

    // 5. Convert to markdown and download.
    const channelName = window.SlackSnapUtils.extractChannelName();
    const markdown = convertToMarkdown(messages, channelName, config);
    const filename = window.SlackSnapUtils.generateFilename(channelName, config);
    
    console.log(`✅ Processed ${messages.length} messages.`);
    
    chrome.runtime.sendMessage({
      action: 'DOWNLOAD_FILE',
      data: { filename, content: markdown, directory: config.downloadDirectory }
    }, (res) => {
      if (res && res.success) {
        window.SlackSnapUtils.showNotification(`✅ Exported ${messages.length} messages to ${filename}`, 'success');
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
 * Fetch thread replies for a message
 * @param {string} channelId - Channel ID
 * @param {string} threadTs - Thread timestamp
 * @param {number} oldestUnix - Oldest timestamp to fetch
 * @param {string} token - Slack auth token
 * @returns {Promise<Array>} Array of reply message objects
 */
async function fetchThreadReplies(channelId, threadTs, oldestUnix, token) {
  try {
    console.log(`🧵 Fetching thread replies for ${threadTs}`);
    
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
      throw new Error(`conversations.replies API failed: ${data.error}`);
    }
    
    console.log(`✅ Found ${data.messages?.length || 0} thread replies`);
    return data.messages || [];
  } catch (error) {
    console.error('❌ Failed to fetch thread replies:', error);
    return []; // Return empty array on error to avoid breaking the export
  }
}

console.log('🚀 SlackSnap content script loaded');
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