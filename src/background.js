/**
 * Background service worker for SlackSnap extension
 */

/**
 * Handle extension icon click
 */
chrome.action.onClicked.addListener(async (tab) => {
  try {
    console.log('🚀 Extension icon clicked!');
    console.log('Tab info:', { id: tab.id, url: tab.url, title: tab.title });
    
    // Check if we're on a Slack page
    if (!tab.url.includes('slack.com')) {
      console.log('❌ Not on a Slack page, cannot export messages');
      console.log('Current URL:', tab.url);
      return;
    }
    
    console.log('✅ On Slack page, starting export for tab:', tab.id);
    
    // Send message to content script to start export
    console.log('Sending EXPORT_MESSAGES to content script...');

    let exportResponse = null; // Track export result across scopes

    try {
      exportResponse = await chrome.tabs.sendMessage(tab.id, {
        action: 'EXPORT_MESSAGES'
      });
      
      console.log('Response from content script:', exportResponse);
    } catch (messageError) {
      console.error('❌ Could not reach content script:', messageError.message);
      console.log('This usually means:');
      console.log('1. Content script not loaded on this page');
      console.log('2. Content script has JavaScript errors');
      console.log('3. Page URL doesn\'t match content script pattern');
      console.log('4. Content script crashed during loading');
      
      // Try to inject content script manually
      console.log('🔧 Attempting to inject content script manually...');
      
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['src/config.js', 'src/utils.js', 'src/content.js']
        });
        
        console.log('✅ Manual injection successful, retrying message...');
        
        // Wait a moment for script to initialize
        setTimeout(async () => {
          try {
            const retryResponse = await chrome.tabs.sendMessage(tab.id, {
              action: 'EXPORT_MESSAGES'
            });
            console.log('✅ Retry successful:', retryResponse);
          } catch (retryError) {
            console.error('❌ Retry failed:', retryError.message);
          }
        }, 1000);
        
      } catch (injectionError) {
        console.error('❌ Manual injection failed:', injectionError.message);
        console.log('Check if you have permission to access this page');
      }
    }
    
    if (exportResponse && exportResponse.success) {
      console.log('✅ Export completed successfully via', exportResponse.method);
    } else {
      console.error('❌ Export failed:', exportResponse?.error || 'Unknown error');
    }
    
  } catch (error) {
    console.error('❌ Failed to handle extension click:', error);
    console.error('Error details:', {
      name: error.name,
      message: error.message,
      stack: error.stack
    });
  }
});

/**
 * Handle messages from content script
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('📨 Background received message:', message);
  
  if (message.action === 'DOWNLOAD_FILE') {
    handleFileDownload(message.data)
      .then(() => sendResponse({ success: true }))
      .catch(error => {
        console.error('Download failed:', error);
        sendResponse({ success: false, error: error.message });
      });
    
    // Return true to indicate we'll respond asynchronously
    return true;
  }
  
  if (message.action === 'DOWNLOAD_FILE_BLOB') {
    handleBlobDownload(message.data)
      .then(() => sendResponse({ success: true }))
      .catch(error => {
        console.error('Blob download failed:', error);
        sendResponse({ success: false, error: error.message });
      });
    
    // Return true to indicate we'll respond asynchronously
    return true;
  }
  
  if (message.action === 'DOWNLOAD_SLACK_FILE') {
    handleSlackFileDownload(message.data)
      .then(() => sendResponse({ success: true }))
      .catch(error => {
        console.error('Slack file download failed:', error);
        sendResponse({ success: false, error: error.message });
      });
    
    // Return true to indicate we'll respond asynchronously
    return true;
  }
  
  if (message.action === 'CONTENT_SCRIPT_READY') {
    console.log('✅ Content script ready on tab:', sender.tab?.id);
    return;
  }
  
  console.log('❓ Unknown message from content script:', message.action);
});

/**
 * Handle file download request
 * @param {Object} data - Download data containing filename and content
 * @returns {Promise<void>}
 */
async function handleFileDownload(data) {
  try {
    console.log('📥 Starting background file download (fallback method)...');
    const { filename, content, directory } = data;
    console.log('Download details:', {
      filename,
      contentLength: content?.length,
      directory,
      hasContent: !!content
    });
    
    if (!content) {
      throw new Error('No content provided for download');
    }
    
    // Convert content to data URL (works in service workers)
    const dataUrl = 'data:text/markdown;charset=utf-8,' + encodeURIComponent(content);
    console.log('📝 Created data URL');
    
    // Ensure directory path is properly formatted
    let downloadPath = filename;
    if (directory && directory.trim()) {
      // Clean directory name and ensure proper path format
      const cleanDirectory = directory.trim().replace(/[\/\\]/g, '');
      downloadPath = `${cleanDirectory}/${filename}`;
    }
    console.log('📂 Download path:', downloadPath);
    
    const downloadOptions = {
      url: dataUrl,
      filename: downloadPath,
      saveAs: false,
      conflictAction: 'uniquify' // Auto-rename if file exists
    };
    
    console.log('📤 Download options:', downloadOptions);
    const downloadId = await chrome.downloads.download(downloadOptions);
    
    console.log('✅ Background download started with ID:', downloadId);
    
  } catch (error) {
    console.error('❌ Failed background download:', error);
    console.error('Error details:', {
      name: error.name,
      message: error.message,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Handle Slack file download (fetches file from Slack and downloads it)
 * @param {Object} data - Download data containing fileUrl, filename, mimetype, and token
 * @returns {Promise<void>}
 */
async function handleSlackFileDownload(data) {
  try {
    console.log('📥 Starting Slack file download...');
    const { fileUrl, filename, mimetype, token } = data;
    console.log('Slack file download details:', {
      filename,
      mimetype,
      fileUrl: fileUrl.substring(0, 50) + '...'
    });
    
    if (!fileUrl || !token) {
      throw new Error('Missing fileUrl or token');
    }
    
    // Fetch file from Slack with authentication
    const response = await fetch(fileUrl, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    // Get file content as array buffer
    const arrayBuffer = await response.arrayBuffer();
    
    // Convert array buffer to base64
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64Data = btoa(binary);
    
    // Determine MIME type
    const contentType = mimetype || response.headers.get('content-type') || 'application/octet-stream';
    const dataUrl = `data:${contentType};base64,${base64Data}`;
    
    // Download via Chrome downloads API
    const downloadOptions = {
      url: dataUrl,
      filename: filename,
      saveAs: false,
      conflictAction: 'uniquify'
    };
    
    console.log('📤 Downloading Slack file:', filename);
    const downloadId = await chrome.downloads.download(downloadOptions);
    
    console.log('✅ Slack file download started with ID:', downloadId);
    
  } catch (error) {
    console.error('❌ Failed Slack file download:', error);
    console.error('Error details:', {
      name: error.name,
      message: error.message,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Handle blob file download (for binary files like images, PDFs, etc.)
 * @param {Object} data - Download data containing filename, dataUrl, and mimeType
 * @returns {Promise<void>}
 */
async function handleBlobDownload(data) {
  try {
    console.log('📥 Starting blob file download...');
    const { filename, dataUrl, mimeType } = data;
    console.log('Blob download details:', {
      filename,
      mimeType,
      dataUrlLength: dataUrl?.length
    });
    
    if (!dataUrl) {
      throw new Error('No data URL provided for download');
    }
    
    // Ensure directory path is properly formatted
    const downloadOptions = {
      url: dataUrl,
      filename: filename,
      saveAs: false,
      conflictAction: 'uniquify' // Auto-rename if file exists
    };
    
    console.log('📤 Blob download options:', { ...downloadOptions, url: '[data URL]' });
    const downloadId = await chrome.downloads.download(downloadOptions);
    
    console.log('✅ Blob download started with ID:', downloadId);
    
  } catch (error) {
    console.error('❌ Failed blob download:', error);
    console.error('Error details:', {
      name: error.name,
      message: error.message,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Handle extension installation
 */
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('SlackSnap extension installed');
    
    // Set default configuration
    chrome.storage.sync.set({
      downloadDirectory: "slack-exports",
      fileNameFormat: "YYYYMMDD-HHmm-{channel}.md",
      includeTimestamps: true,
      includeThreadReplies: true,
      historyDays: 7,
      channels: [],
      lastExportTimestamps: {},
      combinedExport: false
    });
  }
}); 