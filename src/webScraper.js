import axios from 'axios';
import * as cheerio from 'cheerio';

/**
 * WebScraper - Scrapes web search results and fetches web pages
 * Provides internet access for the LLM without requiring API keys
 */
class WebScraper {
  constructor() {
    // User agent to avoid being blocked
    this.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

    // Axios instance with timeout
    this.client = axios.create({
      timeout: 15000, // 15 second timeout
      headers: {
        'User-Agent': this.userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      }
    });
  }

  /**
   * Search the web using DuckDuckGo HTML search
   * @param {string} query - Search query
   * @param {number} maxResults - Maximum number of results to return
   * @returns {Promise<Array<Object>>} - Array of search results
   */
  async searchWeb(query, maxResults = 8) {
    try {
      // DuckDuckGo HTML search (no JavaScript required)
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

      const response = await this.client.get(url);
      const $ = cheerio.load(response.data);

      const results = [];

      // Parse search results
      $('.result').each((i, element) => {
        if (results.length >= maxResults) return false; // Stop when we have enough

        const $result = $(element);
        const $titleLink = $result.find('.result__a');
        const $snippet = $result.find('.result__snippet');

        const title = $titleLink.text().trim();
        const url = $titleLink.attr('href');
        const snippet = $snippet.text().trim();

        if (title && url) {
          results.push({
            title,
            url,
            snippet: snippet || 'No description available'
          });
        }
      });

      return results;
    } catch (error) {
      throw new Error(`Web search failed: ${error.message}`);
    }
  }

  /**
   * Fetch and extract text content from a web page
   * @param {string} url - URL to fetch
   * @param {number} maxLength - Maximum content length in characters
   * @returns {Promise<Object>} - Page title and text content
   */
  async fetchWebPage(url, maxLength = 10000) {
    try {
      const response = await this.client.get(url);
      const $ = cheerio.load(response.data);

      // Remove script, style, and other non-content elements
      $('script, style, nav, header, footer, iframe, noscript').remove();

      // Get page title
      const title = $('title').text().trim() || 'Untitled';

      // Extract text from main content areas
      // Try common content containers first
      let content = '';
      const contentSelectors = [
        'main',
        'article',
        '[role="main"]',
        '.content',
        '#content',
        '.post-content',
        '.entry-content',
        'body'
      ];

      for (const selector of contentSelectors) {
        const $content = $(selector);
        if ($content.length > 0) {
          content = $content.text();
          break;
        }
      }

      // If no specific content area found, get all text from body
      if (!content) {
        content = $('body').text();
      }

      // Clean up whitespace
      content = content
        .replace(/\s+/g, ' ') // Collapse whitespace
        .replace(/\n\s*\n/g, '\n\n') // Normalize line breaks
        .trim();

      // Truncate if too long
      if (content.length > maxLength) {
        content = content.substring(0, maxLength) + '\n\n[Content truncated - page is longer than limit]';
      }

      return {
        title,
        url,
        content,
        length: content.length
      };
    } catch (error) {
      throw new Error(`Failed to fetch web page: ${error.message}`);
    }
  }

  /**
   * Format search results for display to LLM
   * @param {Array<Object>} results - Search results
   * @returns {string} - Formatted text
   */
  formatSearchResults(results) {
    if (results.length === 0) {
      return 'No search results found.';
    }

    let formatted = `Found ${results.length} search results:\n\n`;

    results.forEach((result, i) => {
      formatted += `${i + 1}. ${result.title}\n`;
      formatted += `   URL: ${result.url}\n`;
      formatted += `   ${result.snippet}\n\n`;
    });

    return formatted;
  }

  /**
   * Format web page content for display to LLM
   * @param {Object} pageData - Page data from fetchWebPage
   * @returns {string} - Formatted text
   */
  formatWebPage(pageData) {
    let formatted = `Page: ${pageData.title}\n`;
    formatted += `URL: ${pageData.url}\n`;
    formatted += `Length: ${pageData.length} characters\n\n`;
    formatted += `Content:\n${pageData.content}`;

    return formatted;
  }
}

export default WebScraper;
