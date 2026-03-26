import { Sendable } from '../../models/Sendable';
import { TaskBuilder } from '../../models/TaskBuilder';
import { htmlToElement } from '../../utils/dom';
import { Parser } from '../Parser';

export class PTAProblemParser extends Parser {
  public getMatchPatterns(): string[] {
    return ['https://pintia.cn/problem-sets/*/exam/problems/type/*'];
  }

  public async parse(url: string, html: string): Promise<Sendable> {
    const elem = htmlToElement(html);
    const task = new TaskBuilder('PTA').setUrl(url);

    console.log('[PTA Parser] Starting parse...');

    // Check if user is logged in
    const isLoginPage = elem.querySelector('.content_tiP2H') !== null || 
                        elem.querySelector('h1')?.textContent?.includes('登录') ||
                        url.includes('/auth/login');
    
    if (isLoginPage) {
      throw new Error('PTA requires login. Please log in to your PTA account and try again.');
    }

    // Parse problem name
    const titleEl = elem.querySelector('.text-darkest');
    if (titleEl?.textContent) {
      task.setName(titleEl.textContent.trim());
      console.log('[PTA Parser] Name:', task.name);
    }

    // Parse category
    const categoryEl = elem.querySelector('.ellipsis');
    if (categoryEl?.textContent) {
      task.setCategory(categoryEl.textContent.trim());
      console.log('[PTA Parser] Category:', task.category);
    }

    // Parse time and memory limits
    const allElements = elem.querySelectorAll('*');
    for (const el of allElements) {
      const text = el.textContent || '';
      
      if (!task.timeLimit && /\d+\s*ms/.test(text)) {
        const match = /(\d+)\s*ms/.exec(text);
        if (match) {
          const timeLimit = parseInt(match[1], 10);
          if (timeLimit >= 100 && timeLimit <= 10000) {
            task.setTimeLimit(timeLimit);
            console.log('[PTA Parser] Time limit:', timeLimit);
          }
        }
      }
      
      if (!task.memoryLimit && /\d+\s*(MB|KB)/.test(text)) {
        const match = /(\d+)\s*(MB|KB)/.exec(text);
        if (match) {
          let memory = parseInt(match[1], 10);
          const unit = match[2];
          if (unit === 'KB') {
            memory = Math.floor(memory / 1024);
          }
          if (memory >= 1 && memory <= 1024) {
            task.setMemoryLimit(memory);
            console.log('[PTA Parser] Memory limit:', memory);
          }
        }
      }
      
      if (task.timeLimit && task.memoryLimit) {
        break;
      }
    }

    // Parse test cases
    const testCases = this.parseTestCases(elem);
    for (const [input, output] of testCases) {
      task.addTest(input, output);
    }

    console.log('[PTA Parser] Parse complete - Tests:', task.tests.length);
    return task.build();
  }

  private parseTestCases(elem: Element): [string, string][] {
    const testCases: [string, string][] = [];

    // Find all h3 elements
    const h3Elements = Array.from(elem.querySelectorAll('h3'));
    
    for (let i = 0; i < h3Elements.length; i++) {
      const h3 = h3Elements[i];
      const text = h3.textContent?.trim() || '';
      
      // Check if this is an input sample header
      if (/输入样例\s*\d*[:：]?/.test(text)) {
        console.log('[PTA Parser] Found input header:', text);
        
        const inputContent = this.extractSampleData(h3);
        console.log('[PTA Parser] Input content:', inputContent);
        
        if (inputContent) {
          // Look for the corresponding output sample
          for (let j = i + 1; j < h3Elements.length; j++) {
            const outH3 = h3Elements[j];
            const outText = outH3.textContent?.trim() || '';
            
            if (/输出样例\s*\d*[:：]?/.test(outText)) {
              console.log('[PTA Parser] Found output header:', outText);
              const outputContent = this.extractSampleData(outH3);
              console.log('[PTA Parser] Output content:', outputContent);
              
              if (outputContent) {
                testCases.push([inputContent, outputContent]);
                console.log('[PTA Parser] Added test case #', testCases.length);
              }
              break;
            }
          }
        }
      }
    }

    return testCases;
  }

  private extractSampleData(headerElement: Element): string | null {
    // Get the immediate next sibling
    const sibling = headerElement.nextElementSibling;
    
    if (!sibling) {
      console.log('[PTA Parser] No next sibling');
      return null;
    }
    
    // PTA uses CodeMirror which renders content dynamically
    // The data is not in data-code attribute (it's empty)
    // We need to extract from the CodeMirror DOM structure
    
    // Method 1: Look for CodeMirror's line content
    const cmContent = sibling.querySelector('.cm-content');
    if (cmContent) {
      // Get all line elements
      const lines = cmContent.querySelectorAll('.cm-line');
      if (lines.length > 0) {
        const content = Array.from(lines)
          .map(line => line.textContent || '')
          .join('\n')
          .trim();
        if (content) {
          console.log('[PTA Parser] Found CodeMirror content, lines:', lines.length);
          return content;
        }
      }
    }
    
    // Method 2: Look for any element with cm-line class
    const cmLines = sibling.querySelectorAll('.cm-line');
    if (cmLines.length > 0) {
      const content = Array.from(cmLines)
        .map(line => line.textContent || '')
        .join('\n')
        .trim();
      if (content) {
        console.log('[PTA Parser] Found cm-line elements, count:', cmLines.length);
        return content;
      }
    }
    
    // Method 3: Extract from text content, filtering out UI elements
    // Get all text nodes that are not in toolbar or button elements
    const walker = document.createTreeWalker(
      sibling,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          
          // Reject text in toolbar, buttons, etc.
          if (parent.closest('.toolbar_SkQeK') ||
              parent.closest('button') ||
              parent.closest('[class*="toolbar"]') ||
              parent.closest('[class*="button"]')) {
            return NodeFilter.FILTER_REJECT;
          }
          
          // Accept text in cm-line elements or code editor content
          if (parent.closest('.cm-line') ||
              parent.closest('.cm-content') ||
              parent.closest('.codeEditor_CHvdZ')) {
            return NodeFilter.FILTER_ACCEPT;
          }
          
          return NodeFilter.FILTER_REJECT;
        }
      }
    );
    
    let content = '';
    let node;
    while (node = walker.nextNode()) {
      content += node.textContent;
    }
    
    content = content.trim();
    if (content) {
      console.log('[PTA Parser] Found text content, length:', content.length);
      return content;
    }
    
    // Method 4: Last resort - get all text and clean it
    const allText = sibling.textContent || '';
    if (allText) {
      // Clean up the text - remove UI elements and common patterns
      let cleaned = allText
        .replace(/复制/g, '')
        .replace(/全屏/g, '')
        .replace(/content_copy/g, '')
        .replace(/fullscreen/g, '')
        .replace(/\[\s*in\s*\]/gi, '')
        .replace(/\[\s*out\s*\]/gi, '')
        .replace(/内容格式/g, '')
        .replace(/\d+▸/g, '')  // Remove line numbers like "91▸"
        .replace(/\n\s*\n/g, '\n')
        .trim();
      
      if (cleaned) {
        console.log('[PTA Parser] Found cleaned text, length:', cleaned.length);
        return cleaned;
      }
    }
    
    console.log('[PTA Parser] No data found');
    return null;
  }
}
