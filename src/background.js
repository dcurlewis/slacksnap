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
 * Tries files.download API endpoint first, falls back to direct URL
 * @param {Object} data - Download data containing fileId, fileUrl, filename, mimetype, and token
 * @returns {Promise<void>}
 */
async function handleSlackFileDownload(data) {
  try {
    console.log('📥 Starting Slack file download...');
    const { fileId, fileUrl, filename, mimetype, token } = data;
    console.log('Slack file download details:', {
      filename,
      mimetype,
      hasFileId: !!fileId,
      fileUrl: fileUrl ? fileUrl.substring(0, 100) + '...' : 'none'
    });
    
    if (!token) {
      throw new Error('Missing token');
    }
    
    let actualFileUrl = fileUrl;
    
    // For PDFs, try to get a fresh URL from Slack API first (PDF URLs may expire faster)
    const isPdf = mimetype && mimetype.toLowerCase() === 'application/pdf';
    
    if (isPdf && fileId) {
      console.log(`📄 PDF detected, attempting to get fresh URL from API for file ID: ${fileId}...`);
      try {
        const infoResponse = await fetch(`https://slack.com/api/files.info?file=${fileId}`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        });
        
        if (infoResponse.ok) {
          const infoData = await infoResponse.json();
          if (infoData.ok && infoData.file && infoData.file.url_private) {
            actualFileUrl = infoData.file.url_private;
            console.log(`✅ Got fresh PDF URL from API`);
          } else {
            console.warn(`⚠️ API response not OK or missing URL:`, infoData);
          }
        } else {
          console.warn(`⚠️ API request failed: ${infoResponse.status}`);
        }
      } catch (apiError) {
        console.warn('⚠️ Failed to get file info from API, using original URL:', apiError.message);
      }
    }
    
    // If we have a file ID but no URL, try to get it from Slack API
    if (fileId && !actualFileUrl) {
      console.log(`🔄 No URL provided, fetching file info from API for file ID: ${fileId}...`);
      try {
        const infoResponse = await fetch(`https://slack.com/api/files.info?file=${fileId}`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        });
        
        if (infoResponse.ok) {
          const infoData = await infoResponse.json();
          if (infoData.ok && infoData.file && infoData.file.url_private) {
            actualFileUrl = infoData.file.url_private;
            console.log(`✅ Got fresh URL from API`);
          }
        }
      } catch (apiError) {
        console.warn('⚠️ Failed to get file info from API:', apiError.message);
      }
    }
    
    if (!actualFileUrl) {
      throw new Error('No file URL available');
    }
    
    let response;
    
    // Use direct URL method (files.download API endpoint doesn't seem to be available)
    // The url_private URLs work reliably with Bearer token authentication
    try {
      console.log(`🔗 Fetching file from URL: ${actualFileUrl.substring(0, 100)}...`);
      response = await fetch(actualFileUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': '*/*'
        },
        redirect: 'follow' // Follow redirects
      });
      console.log(`✅ Fetch response status: ${response.status} ${response.statusText}`);
    } catch (fetchError) {
      // If fetch fails and we have a file ID, try to get a fresh URL and retry
      if (fileId && actualFileUrl === fileUrl) {
        console.log(`🔄 Fetch failed, trying to get fresh URL from API for file ID: ${fileId}...`);
        try {
          const infoResponse = await fetch(`https://slack.com/api/files.info?file=${fileId}`, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/x-www-form-urlencoded'
            }
          });
          
          if (infoResponse.ok) {
            const infoData = await infoResponse.json();
            if (infoData.ok && infoData.file && infoData.file.url_private) {
              const freshUrl = infoData.file.url_private;
              console.log(`✅ Got fresh URL from API, retrying fetch...`);
              
              // Retry with fresh URL
              response = await fetch(freshUrl, {
                method: 'GET',
                headers: {
                  'Authorization': `Bearer ${token}`,
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                  'Accept': '*/*'
                },
                redirect: 'follow'
              });
              console.log(`✅ Retry fetch response status: ${response.status} ${response.statusText}`);
            } else {
              throw fetchError; // Re-throw original error if API call didn't help
            }
          } else {
            throw fetchError; // Re-throw original error if API call failed
          }
        } catch (apiError) {
          console.error('❌ Failed to refresh URL via API:', apiError.message);
          throw fetchError; // Re-throw original fetch error
        }
      } else {
        console.error('❌ Fetch error details:', {
          name: fetchError.name,
          message: fetchError.message,
          stack: fetchError.stack,
          fileUrl: actualFileUrl.substring(0, 100)
        });
        throw new Error(`Failed to fetch: ${fetchError.message}`);
      }
    }
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.error(`❌ HTTP error ${response.status}:`, errorText.substring(0, 200));
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    // Get file content as array buffer
    console.log(`📦 Reading file content (${response.headers.get('content-length') || 'unknown'} bytes)...`);
    const arrayBuffer = await response.arrayBuffer();
    const fileSize = arrayBuffer.byteLength;
    console.log(`✅ Read ${fileSize} bytes`);
    
    // Chrome has limits on data URL size (typically 2MB)
    // For larger files, we need to chunk the base64 conversion or use a different method
    const MAX_DATA_URL_SIZE = 2 * 1024 * 1024; // 2MB
    
    if (fileSize > MAX_DATA_URL_SIZE) {
      console.log(`⚠️ File is large (${fileSize} bytes), may exceed data URL limit`);
      console.log(`📦 Attempting base64 conversion anyway (Chrome may handle it)...`);
    }
    
    // For smaller files, use data URL method
    console.log(`📦 Converting to base64 (file size: ${fileSize} bytes)...`);
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
      stack: error.stack,
      filename: data.filename,
      mimetype: data.mimetype,
      fileUrl: data.fileUrl ? data.fileUrl.substring(0, 100) : 'none'
    });
    
    // Provide more detailed error message
    let errorMessage = error.message;
    if (error.message.includes('Failed to fetch')) {
      errorMessage = `Failed to fetch file: ${error.message}. This may be due to network issues, expired URLs, or CORS restrictions.`;
    }
    
    throw new Error(errorMessage);
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