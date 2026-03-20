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

        // Find "Seen by" OR "Viewers" (Instagram changed the text)
        const seenBySpan = Array.from(document.querySelectorAll("span")).find(el =>
            el.innerText && el.innerText.match(/Seen by|Viewers|viewers/i)
        );
        if (!seenBySpan) return { error: "'Seen by / Viewers' button not found." };

        console.log("[BOT] Found viewer button text:", seenBySpan.innerText);

        // Click closest button
        const seenBtn = seenBySpan.closest('button') || seenBySpan.closest('div[role="button"]');
        if (seenBtn) seenBtn.click();
        else seenBySpan.click(); // Fallback: click the span itself

        await humanDelay(2, 3);

        // Try multiple selectors for the dialog
        const dialog = document.querySelector('div[role="dialog"]')
            || document.querySelector('div[style*="position: fixed"]')
            || document.querySelector('div[class*="dialog"]');
        if (!dialog) return { error: "Viewers dialog didn't open." };

        console.log("[BOT] Dialog found. Collecting viewers...");

        // Find the scrollable container inside the dialog
        const scrollable = dialog.querySelector('div[style*="overflow"]')
            || dialog.querySelector('ul')?.parentElement
            || dialog;

        // Collect usernames using multiple strategies
        function collectUsernames(container) {
            const viewers = new Set();

            // Strategy 1: Links with href pointing to profiles
            const links = Array.from(container.querySelectorAll("a"));
            for (const link of links) {
                const href = link.getAttribute('href');
                if (href && href.startsWith('/') && !href.includes('/p/') && !href.includes('/reel/')) {
                    const un = href.replace(/^\//, '').replace(/\/$/, '');
                    if (un && !un.includes('/') && !un.includes('?') && un !== 'direct' && un !== 'explore') {
                        viewers.add(un);
                    }
                }
            }

            // Strategy 2: If no links found, look for username-style spans near avatar images
            if (viewers.size === 0) {
                const imgs = container.querySelectorAll('img[alt]');
                for (const img of imgs) {
                    const alt = img.getAttribute('alt');
                    // Instagram profile pics have alt text like "username's profile picture"
                    if (alt && alt.includes("profile picture")) {
                        const un = alt.split("'")[0].trim();
                        if (un && un.length > 0 && !un.includes(' ')) {
                            viewers.add(un);
                        }
                    }
                }
            }

            return viewers;
        }

        // Scroll loop to load all viewers
        let lastCount = 0;
        let attempts = 0;

        while (attempts < 35) {
            const currentViewers = collectUsernames(dialog);
            const currentCount = currentViewers.size;

            if (currentCount > lastCount) {
                lastCount = currentCount;
                attempts = 0;

                // Scroll the last element into view within the dialog
                const allItems = dialog.querySelectorAll("a, li, div[role='listitem']");
                if (allItems.length > 0) {
                    allItems[allItems.length - 1].scrollIntoView({ behavior: 'smooth', block: 'end' });
                } else {
                    // Fallback: scroll the scrollable container
                    scrollable.scrollTop = scrollable.scrollHeight;
                }

                await sleep(1500);
            } else {
                attempts++;
                // Try scrolling even if count didn't change
                scrollable.scrollTop = scrollable.scrollHeight;
                await sleep(500);
            }
            if (attempts > 5) break; // Reached bottom — gave a bit more patience
        }

        const finalViewers = collectUsernames(dialog);
        console.log(`[BOT] Collected ${finalViewers.size} viewers total.`);

        return { success: true, viewers: Array.from(finalViewers) };
    } catch (e) {
        console.error("[BOT] scrapeViewers error:", e);
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
    
    // Restricted Location Scanner — ONLY scan tiny profile card elements, NEVER the full page
    // Calling .innerText on large containers (div[role="main"], body) freezes the tab
    // on long chat histories because the browser must serialize thousands of DOM nodes.
    console.log("[BOT] Scanning profile card for restricted locations...");

    const locs = (restrictedLocsStr || "").split(",").map(s => s.trim().toLowerCase()).filter(s => s);

    if (locs.length > 0) {
        // Collect text ONLY from small, specific elements — never a large parent container
        let profileTexts = [];

        // 1. The profile card at the top of DM thread (name, bio snippet)
        //    Look for the "View profile" link/button — the card is nearby
        const viewProfileBtn = Array.from(document.querySelectorAll('a, div[role="button"], button'))
            .find(el => el.innerText && el.innerText.trim().toLowerCase() === 'view profile');

        if (viewProfileBtn) {
            // The profile card is typically the parent or grandparent of "View profile"
            const card = viewProfileBtn.parentElement?.parentElement;
            if (card) {
                // Only read direct child spans/divs text, not the whole subtree
                const cardChildren = card.querySelectorAll(':scope > *, :scope > * > *');
                for (const child of cardChildren) {
                    if (child.children.length < 5 && child.innerText && child.innerText.length < 300) {
                        profileTexts.push(child.innerText.toLowerCase());
                    }
                }
            }
        }

        // 2. Also check the header area if it exists (small element)
        const headerArea = document.querySelector('div[role="main"] header');
        if (headerArea && headerArea.innerText && headerArea.innerText.length < 500) {
            profileTexts.push(headerArea.innerText.toLowerCase());
        }

        // 3. Check any visible bio/subtitle spans near the top
        const nameHeader = document.querySelector('div[role="main"] h2, div[role="main"] h1');
        if (nameHeader) {
            const nearby = nameHeader.parentElement;
            if (nearby && nearby.innerText && nearby.innerText.length < 500) {
                profileTexts.push(nearby.innerText.toLowerCase());
            }
        }

        const combinedText = profileTexts.join(" ");
        console.log(`[BOT] Profile card text length: ${combinedText.length} chars`);

        for (const loc of locs) {
            if (combinedText.includes(loc)) {
                console.log(`[!] Skipped: Contains ${loc}`);
                return { skipped: true, reason: `Mentioned Location: ${loc}` };
            }
        }
    }

    // Note: No permanent chat history check — users can be messaged again on different days.
    // Duplicate prevention is handled daily in background.js (messaged_today list resets each day).
    
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

// Wraps any async function with a timeout so the extension never gets permanently stuck
function withTimeout(asyncFn, timeoutMs, timeoutMsg) {
    return Promise.race([
        asyncFn(),
        new Promise((_, reject) => setTimeout(() => reject(new Error(timeoutMsg)), timeoutMs))
    ]);
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "SCRAPE_VIEWERS") {
        withTimeout(() => scrapeViewers(), 120000, "scrapeViewers timed out after 2 minutes")
            .then(sendResponse)
            .catch(err => sendResponse({ error: err.toString() }));
        return true;
    }

    if (request.action === "SEND_MESSAGE") {
        withTimeout(
            () => sendMessage(request.username, request.messageTemplate, request.restrictedLocs),
            90000, // 90 second timeout per message
            `sendMessage timed out for ${request.username}`
        )
            .then(sendResponse)
            .catch(err => sendResponse({ error: err.toString() }));
        return true;
    }
});
