async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function humanDelay(minSec, maxSec) {
    const ms = Math.floor(Math.random() * (maxSec - minSec + 1) + minSec) * 1000;
    return sleep(ms);
}

// Scrapes the story viewers
async function scrapeViewers() {
    console.log("[BOT] Attempting to open active story...");
    try {
        const storyRing = document.querySelector("header canvas");
        if (!storyRing) return { error: "No active story found on this profile." };
        storyRing.click();
        
        await humanDelay(2, 4);
        
        // Find "Seen by"
        const seenBySpan = Array.from(document.querySelectorAll("span")).find(el => el.innerText && el.innerText.match(/Seen by/i));
        if (!seenBySpan) return { error: "'Seen by' button not found." };
        
        // Click closest button
        const seenBtn = seenBySpan.closest('button') || seenBySpan.closest('div[role="button"]');
        if (seenBtn) seenBtn.click();
        
        await humanDelay(2, 3);
        
        const dialog = document.querySelector('div[role="dialog"]');
        if (!dialog) return { error: "Viewers dialog didn't open." };
        
        console.log("[BOT] Scrolling infinitely to grab viewers...");
        let lastCount = 0;
        let attempts = 0;
        
        while (attempts < 35) {
            const links = Array.from(dialog.querySelectorAll("a"));
            if (links.length > lastCount) {
                links[links.length - 1].scrollIntoView();
                lastCount = links.length;
                attempts = 0;
                await sleep(1500);
            } else {
                attempts++;
                await sleep(500);
            }
            if (attempts > 3) break; // Reached bottom
        }
        
        const finalLinks = Array.from(dialog.querySelectorAll("a"));
        const viewers = new Set();
        
        for (const link of finalLinks) {
            const href = link.getAttribute('href');
            if (href && href.startsWith('/') && href.split('/').length === 3) {
                const un = href.replaceAll('/', '');
                if (un && !un.includes('?')) {
                    viewers.add(un);
                }
            }
        }
        
        return { success: true, viewers: Array.from(viewers) };
    } catch (e) {
        return { error: e.toString() };
    }
}

// Types the message instantly and triggers React/Lexical events
async function typeMessage(element, text) {
    if (!text || text.trim() === "") text = "Hey!"; // Fallback just in case
    
    element.focus();
    await sleep(500); // Wait for focus to settle
    
    // Deep focus into the precise paragraph Lexical uses if it's there
    let target = element.querySelector('p') || element;
    target.focus();
    
    // Paste the entire text at once. Native browser insertText correctly fires Lexical updates.
    document.execCommand('insertText', false, text);
    
    // Fire synthetic Input event to confidently enable the Send button
    target.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
}

async function sendMessage(username, messageData, restrictedLocsStr) {
    console.log(`[BOT] Interacting with DM for ${username}`);
    
    await humanDelay(3, 5);
    
    // Dismiss "Not Now" popup for notifications, catching error safely
    try {
        const notNow = Array.from(document.querySelectorAll('button')).find(b => b.innerText === 'Not Now');
        if (notNow) notNow.click();
    } catch(e) {}
    
    // Find pencil icon for New Message
    const pencil = document.querySelector('svg[aria-label="New message"], svg[aria-label="New Message"]');
    if (!pencil) return { error: "Pencil icon not found." };
    
    const pencilBtnDiv = pencil.closest('div[role="button"]');
    if (pencilBtnDiv) pencilBtnDiv.click();
    else if (pencil.parentNode) pencil.parentNode.click();
    
    await humanDelay(2, 3);
    
    // Search their exact username
    const searchInput = document.querySelector('input[placeholder="Search..."], input[name="queryBox"]');
    if (!searchInput) return { error: "Search input not found." };
    
    searchInput.focus();
    document.execCommand('insertText', false, username);
    
    await humanDelay(3, 5);
    
    // Find matching user and click
    const userResult = Array.from(document.querySelectorAll('span')).find(el => el.innerText === username);
    if (!userResult) return { error: "User not found in search." };
    
    userResult.click();
    await humanDelay(1, 2);
    
    // Initiate Chat
    const chatBtn = Array.from(document.querySelectorAll('div[role="button"]')).find(b => b.innerText === 'Chat');
    if (chatBtn) chatBtn.click();
    
    await humanDelay(4, 6);
    
    // Restricted Deep Scanner
    console.log("[BOT] Deep scanning for restricted locations via scrolling...");
    const scrollables = Array.from(document.querySelectorAll('div')).filter(el => {
        const overflow = window.getComputedStyle(el).overflowY;
        return overflow === 'auto' || overflow === 'scroll';
    });
    // Trigger scroll jump twice 
    scrollables.forEach(el => { el.scrollTop = 0; });
    await sleep(1500);
    scrollables.forEach(el => { el.scrollTop = 0; });
    await sleep(1000);
    
    const pageText = document.body.innerText.toLowerCase();
    const locs = restrictedLocsStr.split(",").map(s => s.trim().toLowerCase()).filter(s => s);
    
    for (const loc of locs) {
        if (pageText.includes(loc)) {
            console.log(`[!] Skipped: Contains ${loc}`);
            return { skipped: true, reason: `Mentioned Location: ${loc}` };
        }
    }
    
    // Safety DOM Scanner: Prevent Double Messaging!
    // This physically scans the chat UI for flex-end (right-aligned) blue bubbles that indicates you have already sent messages here before.
    console.log("[BOT] Scanning native chat DOM for any previous sent messages...");
    const texts = Array.from(document.querySelectorAll('div[dir="auto"]')).filter(el => el.innerText.trim().length > 0);
    let hasHistory = false;
    for (const msg of texts) {
        let parent = msg.parentElement;
        let depth = 0;
        
        while (parent && depth < 6) {
            const style = window.getComputedStyle(parent);
            if (style.justifyContent === 'flex-end' || style.alignSelf === 'flex-end' || style.alignItems === 'flex-end') {
                if (msg.innerText.length > 2) { 
                    hasHistory = true;
                    break;
                }
            }
            parent = parent.parentElement;
            depth++;
        }
        if (hasHistory) break;
    }
    
    if (hasHistory) {
        console.log(`[!] Safely Skipped: We detected past chat history inside the DOM!`);
        return { skipped: true, reason: `Chat history already exists from previous days.` };
    }
    
    // Typing the actual DM
    const textboxes = Array.from(document.querySelectorAll('div[contenteditable="true"], textarea, div[role="textbox"]'));
    if (textboxes.length === 0) return { error: "Textbox not found on screen." };
    
    // Filter visible textboxes and pick the last one (DM input usually at bottom)
    const visibleTextboxes = textboxes.filter(tb => tb.offsetParent !== null);
    const textbox = visibleTextboxes[visibleTextboxes.length - 1] || textboxes[textboxes.length - 1];
    
    console.log(`[BOT] Typing message...`);
    await typeMessage(textbox, messageData);
    await humanDelay(2, 3);
    
    // Find the Send button - Instagram's text can sometimes be inside nested spans so exact match is safer
    console.log("[BOT] Searching for Send button...");
    const sendBtn = Array.from(document.querySelectorAll('div[role="button"]')).find(b => b.innerText && b.innerText.trim() === 'Send');
    
    if (sendBtn) {
        sendBtn.click();
        console.log(`[BOT] Send button clicked for ${username}!`);
    } else {
        // Fallback: simulate pressing Enter just in case the button didn't spawn natively
        textbox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        console.log(`[BOT] Enter key dispatched for ${username}!`);
    }
    
    return { success: true };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "SCRAPE_VIEWERS") {
        scrapeViewers().then(sendResponse);
        return true;
    }
    
    if (request.action === "SEND_MESSAGE") {
        sendMessage(request.username, request.messageTemplate, request.restrictedLocs).then(sendResponse);
        return true;
    }
});
